import Foundation
import AVFoundation
import AudioToolbox

enum OpusEncoderError: LocalizedError {
    case invalidInput
    case converterInitFailed
    case encodeFailed(String)
    case emptyOutput

    var errorDescription: String? {
        switch self {
        case .invalidInput: return "PCM inválido para codificação Opus."
        case .converterInitFailed: return "Este iOS não conseguiu iniciar o codificador Opus nativo."
        case .encodeFailed(let msg): return "Falha ao codificar áudio Opus: \(msg)"
        case .emptyOutput: return "O codificador Opus nativo não retornou pacotes."
        }
    }
}

/// Encodes mono 48 kHz Float32 PCM into a standard Ogg/Opus file using Apple's native AVAudioConverter.
final class NativeOpusEncoder {
    private static let sampleRate: Double = 48_000
    private static let crcTable: [UInt32] = (0..<256).map { value in
        var word = UInt32(value) << 24
        for _ in 0..<8 {
            word = (word & 0x8000_0000) != 0 ? ((word << 1) ^ 0x04c1_1db7) : (word << 1)
        }
        return word
    }

    static func encodeToOgg(pcmFloat32Data: Data, bitrate: Int = 32_000) throws -> Data {
        let sampleCount = pcmFloat32Data.count / MemoryLayout<Float>.size
        guard sampleCount > 0 else { throw OpusEncoderError.invalidInput }

        guard let inFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw OpusEncoderError.converterInitFailed
        }

        let clampedBitrate = max(12_000, min(96_000, bitrate))
        let outSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatOpus,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: clampedBitrate
        ]
        guard let outFormat = AVAudioFormat(settings: outSettings),
              let converter = AVAudioConverter(from: inFormat, to: outFormat) else {
            throw OpusEncoderError.converterInitFailed
        }
        converter.bitRate = clampedBitrate

        // Pad tail with 960 samples (20ms) so final Opus frame flushes cleanly
        let totalInputFrames = sampleCount + 960
        guard let inBuffer = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(totalInputFrames)) else {
            throw OpusEncoderError.converterInitFailed
        }
        inBuffer.frameLength = AVAudioFrameCount(totalInputFrames)
        if let channelPtr = inBuffer.floatChannelData?[0] {
            pcmFloat32Data.withUnsafeBytes { raw in
                if let src = raw.bindMemory(to: Float.self).baseAddress {
                    channelPtr.update(from: src, count: sampleCount)
                }
            }
            for i in sampleCount..<totalInputFrames {
                channelPtr[i] = 0
            }
        }

        var packets: [(bytes: Data, samples: Int)] = []
        var offset = 0
        let chunkFrames = 960 * 10
        let maxPacketSize = max(4096, converter.maximumOutputPacketSize)
        var finished = false

        while !finished {
            let compressed = AVAudioCompressedBuffer(
                format: outFormat,
                packetCapacity: 64,
                maximumPacketSize: maxPacketSize
            )
            var convError: NSError?
            let status = converter.convert(to: compressed, error: &convError) { requestedFrames, outStatus in
                if offset >= totalInputFrames {
                    outStatus.pointee = .endOfStream
                    return nil
                }
                let remaining = totalInputFrames - offset
                let count = min(Int(requestedFrames), min(chunkFrames, remaining))
                guard let slice = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(count)),
                      let dst = slice.floatChannelData?[0],
                      let src = inBuffer.floatChannelData?[0] else {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                slice.frameLength = AVAudioFrameCount(count)
                dst.update(from: src.advanced(by: offset), count: count)
                offset += count
                outStatus.pointee = .haveData
                return slice
            }

            if let err = convError {
                throw OpusEncoderError.encodeFailed(err.localizedDescription)
            }

            let packetCount = Int(compressed.packetCount)
            if packetCount > 0, let descs = compressed.packetDescriptions {
                let basePtr = compressed.data
                for i in 0..<packetCount {
                    let desc = descs[i]
                    let size = Int(desc.mDataByteSize)
                    guard size > 0 else { continue }
                    let pktPtr = basePtr.advanced(by: Int(desc.mStartOffset))
                    let pkt = Data(bytes: pktPtr, count: size)
                    let pktSamples = opusPacketSamples(pkt)
                    packets.append((bytes: pkt, samples: pktSamples))
                }
            }

            if status == .endOfStream || (status == .error) {
                finished = true
            } else if status == .inputRanDry {
                if offset >= totalInputFrames { finished = true }
            }
        }

        guard !packets.isEmpty else { throw OpusEncoderError.emptyOutput }
        let preSkip = 312
        return muxOggOpus(packets: packets, channels: 1, preSkip: preSkip, length: sampleCount, vendor: "Pulso-iOS")
    }

    private static func opusPacketSamples(_ bytes: Data) -> Int {
        guard !bytes.isEmpty else { return 960 }
        let b0 = Int(bytes[0])
        let config = b0 >> 3
        let perFrame: Int
        if config >= 16 {
            perFrame = [120, 240, 480, 960][config % 4]
        } else if config >= 12 {
            perFrame = [480, 960][config % 2]
        } else {
            perFrame = [480, 960, 1920, 2880][config % 4]
        }
        let mode = b0 & 3
        let frames: Int
        if mode == 0 {
            frames = 1
        } else if mode == 3 {
            frames = bytes.count > 1 ? Int(bytes[1] & 63) : 1
        } else {
            frames = 2
        }
        let samples = frames * perFrame
        return (samples > 0 && samples <= 5760) ? samples : 960
    }

    private static func oggCrc(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0
        for byte in data {
            let idx = Int(((crc >> 24) ^ UInt32(byte)) & 0xff)
            crc = (crc << 8) ^ crcTable[idx]
        }
        return crc
    }

    private static func oggPage(flags: UInt8, granule: UInt64, serial: UInt32, index: UInt32, packets: [Data]) -> Data {
        var laces: [UInt8] = []
        for pkt in packets {
            var len = pkt.count
            while len >= 255 {
                laces.append(255)
                len -= 255
            }
            laces.append(UInt8(len))
        }
        var page = Data()
        page.append(contentsOf: [0x4f, 0x67, 0x67, 0x53]) // OggS
        page.append(0) // version
        page.append(flags)
        var g = granule.littleEndian
        page.append(Data(bytes: &g, count: 8))
        var s = serial.littleEndian
        page.append(Data(bytes: &s, count: 4))
        var idx = index.littleEndian
        page.append(Data(bytes: &idx, count: 4))
        var zeroCrc: UInt32 = 0
        page.append(Data(bytes: &zeroCrc, count: 4))
        page.append(UInt8(laces.count))
        page.append(contentsOf: laces)
        for pkt in packets { page.append(pkt) }

        var crc = oggCrc(page).littleEndian
        page.replaceSubrange(22..<26, with: Data(bytes: &crc, count: 4))
        return page
    }

    private static func muxOggOpus(
        packets: [(bytes: Data, samples: Int)],
        channels: UInt8,
        preSkip: Int,
        length: Int,
        vendor: String
    ) -> Data {
        let serial = UInt32.random(in: 1...UInt32.max)
        var head = Data(count: 19)
        head.replaceSubrange(0..<8, with: Data("OpusHead".utf8))
        head[8] = 1
        head[9] = channels
        var ps = UInt16(preSkip).littleEndian
        head.replaceSubrange(10..<12, with: Data(bytes: &ps, count: 2))
        var sr = UInt32(48_000).littleEndian
        head.replaceSubrange(12..<16, with: Data(bytes: &sr, count: 4))

        let vendorBytes = Data(vendor.utf8)
        var tags = Data(count: 16 + vendorBytes.count)
        tags.replaceSubrange(0..<8, with: Data("OpusTags".utf8))
        var vlen = UInt32(vendorBytes.count).littleEndian
        tags.replaceSubrange(8..<12, with: Data(bytes: &vlen, count: 4))
        tags.replaceSubrange(12..<(12 + vendorBytes.count), with: vendorBytes)

        var output = Data()
        var pageIndex: UInt32 = 0
        output.append(oggPage(flags: 0x02, granule: 0, serial: serial, index: pageIndex, packets: [head]))
        pageIndex += 1
        output.append(oggPage(flags: 0x00, granule: 0, serial: serial, index: pageIndex, packets: [tags]))
        pageIndex += 1

        var position = 0
        let finalGranule = length + preSkip
        let groupSize = 20
        var i = 0
        while i < packets.count && position < finalGranule {
            var group: [Data] = []
            let endIdx = min(packets.count, i + groupSize)
            for j in i..<endIdx {
                group.append(packets[j].bytes)
                position += packets[j].samples
                if position >= finalGranule { break }
            }
            let isEnd = position >= finalGranule || endIdx >= packets.count
            let gran = UInt64(isEnd ? finalGranule : position)
            output.append(oggPage(flags: isEnd ? 0x04 : 0x00, granule: gran, serial: serial, index: pageIndex, packets: group))
            pageIndex += 1
            i += groupSize
        }
        return output
    }
}
