import Foundation
import AVFoundation
import ScreenCaptureKit
import AudioToolbox

// Phase 1: minimal CLI that captures system audio and writes base64 PCM16 mono 16kHz frames to stdout.

// Config
let sampleRate: Double = 16_000
let frameDurationSec: Double = 0.1 // 100 ms
let channels: AVAudioChannelCount = 1

// Print version info function
func printVersionInfo() {
    FileHandle.standardError.write("SystemAudioCapture v1.0 starting\n".data(using: .utf8)!)
    FileHandle.standardError.write("macOS version: \(ProcessInfo.processInfo.operatingSystemVersionString)\n".data(using: .utf8)!)
}

@available(macOS 13.0, *)
final class AudioDumper: NSObject {
    private var stream: SCStream?
    private var output: SCStreamOutput?
    private var audioConverter: AVAudioConverter?
    private var dstFormat: AVAudioFormat
    private let dstFrameCapacity: AVAudioFrameCount
    // Stats & debug dump
    private var totalFrames: Int = 0
    private var totalBytes: Int = 0
    private var totalChunks: Int = 0
    private var lastStatsTs: TimeInterval = Date().timeIntervalSince1970
    private var wavBuffer = Data()
    private let wavMaxSeconds: Double = 5.0

    override init() {
        self.dstFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: channels, interleaved: true)!
        self.dstFrameCapacity = AVAudioFrameCount(sampleRate * frameDurationSec)
        super.init()
    }

    func start() async throws {
        // Explicitly log that we're starting the permission request
        let startingMsg = "{\"status\":\"starting\",\"message\":\"Requesting screen recording permissions...\"}\n"
        FileHandle.standardError.write(startingMsg.data(using: .utf8)!)
        
        // Request capture permission explicitly with better error handling
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
            
            // Log success
            let permissionMsg = "{\"status\":\"permission_granted\",\"message\":\"Screen recording permission granted\"}\n"
            FileHandle.standardError.write(permissionMsg.data(using: .utf8)!)
        } catch {
            // Log detailed permission error
            let errorMsg = "{\"status\":\"permission_error\",\"error\":\"\(String(describing: error).replacingOccurrences(of: "\"", with: "'"))\"}\n"
            FileHandle.standardError.write(errorMsg.data(using: .utf8)!)
            throw error
        }
        
        guard let display = content.displays.first else {
            let noDisplayMsg = "{\"status\":\"error\",\"error\":\"No display found\"}\n"
            FileHandle.standardError.write(noDisplayMsg.data(using: .utf8)!)
            throw NSError(domain: "SystemAudioCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }
        
        // Log display info
        let displayMsg = "{\"status\":\"display_found\",\"display_id\":\(display.displayID),\"width\":\(display.width),\"height\":\(display.height)}\n"
        FileHandle.standardError.write(displayMsg.data(using: .utf8)!)

        // Configure stream for audio only
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false
        config.sampleRate = Int(sampleRate)
        config.channelCount = Int(channels)

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        self.stream = stream

        let output = StreamOutput(format: dstFormat, frameCapacity: dstFrameCapacity, parent: self)
        self.output = output
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: .global())

        let outputAddedMsg = "{\"status\":\"output_added\"}\n"
        FileHandle.standardError.write(outputAddedMsg.data(using: .utf8)!)

        // Log that we're about to start capture
        let startCaptureMsg = "{\"status\":\"starting_capture\",\"message\":\"Starting audio capture stream\"}\n"
        FileHandle.standardError.write(startCaptureMsg.data(using: .utf8)!)
        
        do {
            try await stream.startCapture()
            
            // Log successful capture start
            let captureStartedMsg = "{\"status\":\"capture_started\",\"message\":\"Audio capture stream started successfully\"}\n"
            FileHandle.standardError.write(captureStartedMsg.data(using: .utf8)!)
        } catch {
            // Log capture start error
            let errorStr = String(describing: error).replacingOccurrences(of: "\"", with: "'")
            let captureErrorMsg = "{\"status\":\"capture_error\",\"error\":\"\(errorStr)\"}\n"
            FileHandle.standardError.write(captureErrorMsg.data(using: .utf8)!)
            throw error
        }

        // Keep running
        // Keep process alive
        let runningMsg = "{\"status\":\"running\",\"message\":\"Audio capture running\"}\n"
        FileHandle.standardError.write(runningMsg.data(using: .utf8)!)
        
        // Use Task.sleep instead of RunLoop in async context
        while true { 
            try? await Task.sleep(nanoseconds: 250_000_000) // 250ms
        }
    }

    @available(macOS 13.0, *)
    private final class StreamOutput: NSObject, SCStreamOutput {
        private let dstFormat: AVAudioFormat
        private let frameCapacity: AVAudioFrameCount
        private var converter: AVAudioConverter?
        // Back-reference for stats/dump
        private weak var parent: AudioDumper?

        init(format: AVAudioFormat, frameCapacity: AVAudioFrameCount, parent: AudioDumper? = nil) {
            self.dstFormat = format
            self.frameCapacity = frameCapacity
            self.parent = parent
        }

        func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
            guard type == .audio, let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

            // Extract ASBD from CMSampleBuffer
            guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
                  let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)?.pointee else { return }

            let srcFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                          sampleRate: asbd.mSampleRate,
                                          channels: AVAudioChannelCount(asbd.mChannelsPerFrame),
                                          interleaved: false)!

            if converter == nil {
                converter = AVAudioConverter(from: srcFormat, to: dstFormat)
            }

            // Read audio into AVAudioPCMBuffer (float32)
            let totalLength = CMBlockBufferGetDataLength(blockBuffer)
            var data = Data(count: totalLength)
            data.withUnsafeMutableBytes { (ptr: UnsafeMutableRawBufferPointer) in
                _ = CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: totalLength, destination: ptr.baseAddress!)
            }

            let frameCount = AVAudioFrameCount(totalLength) / (4 * AVAudioFrameCount(srcFormat.channelCount))
            guard frameCount > 0 else { return }

            guard let srcBuf = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: frameCount) else { return }
            srcBuf.frameLength = frameCount

            // Copy float32 samples into srcBuf honoring interleaved vs non-interleaved layout
            let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
            data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
                let base = ptr.baseAddress!.assumingMemoryBound(to: Float.self)
                let channels = Int(srcFormat.channelCount)
                let frames = Int(frameCount)
                if isNonInterleaved {
                    // Planar: [ch0 frames][ch1 frames]...
                    let planeSamples = frames
                    for ch in 0..<channels {
                        let srcPlane = base.advanced(by: ch * planeSamples)
                        let dst = srcBuf.floatChannelData![ch]
                        dst.update(from: srcPlane, count: planeSamples)
                    }
                } else {
                    // Interleaved: ch0, ch1, ch2 ... per frame
                    for ch in 0..<channels {
                        let dst = srcBuf.floatChannelData![ch]
                        var i = ch
                        for f in 0..<frames {
                            dst[f] = base[i]
                            i += channels
                        }
                    }
                }
            }

            let jsonSrc = "{\"src_format\":{\"src_format_flags_hex\":\"00000029\",\"src_format_id_hex\":\"6C70636D\",\"src_bits_per_channel\":32,\"src_sample_rate\":\(Int(asbd.mSampleRate)),\"src_non_interleaved\":true,\"src_bytes_per_frame\":4,\"src_channels\":\(Int(asbd.mChannelsPerFrame))},\"status\":\"src_format\"}\n"
            FileHandle.standardError.write(jsonSrc.data(using: .utf8)!)

            // Convert to dst (int16 mono 16k)
            guard let dstBuf = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: frameCapacity) else { return }
            let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
                outStatus.pointee = .haveData
                return srcBuf
            }
            // Convert without try-catch since convert doesn't throw when error param is nil
            converter?.convert(to: dstBuf, error: nil, withInputFrom: inputBlock)

            // Emit in chunks ~100ms
            let frames = Int(dstBuf.frameLength)
            guard frames > 0, let int16Ptr = dstBuf.int16ChannelData?.pointee else { return }
            let jsonFirst = "{\"status\":\"first-chunk\"}\n"
            FileHandle.standardError.write(jsonFirst.data(using: .utf8)!)

            let bytesPerFrame = MemoryLayout<Int16>.size * Int(dstFormat.channelCount)
            let byteCount = frames * bytesPerFrame
            let b64 = Data(bytes: int16Ptr, count: byteCount).base64EncodedString()
            // Write JSON line to stdout
            let obj: [String: Any] = ["data": b64, "mimeType": "audio/pcm;rate=16000"]
            if let json = try? JSONSerialization.data(withJSONObject: obj),
               let line = String(data: json, encoding: .utf8) {
                FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
            }
            let jsonConverted = "{\"dst_frames\":\(frames),\"status\":\"converted\"}\n"
            FileHandle.standardError.write(jsonConverted.data(using: .utf8)!)

            // Update stats
            parent?.totalFrames += frames
            parent?.totalBytes += byteCount
            parent?.totalChunks += 1
            let now = Date().timeIntervalSince1970
            if let last = parent?.lastStatsTs, now - last >= 1.0 {
                let fps = parent!.totalChunks
                let kbps = Double(parent!.totalBytes) / 1024.0
                let stats = String(format: "{\"status\":\"stats\",\"chunks\":%d,\"bytes_kb\":%.2f}\n", fps, kbps)
                FileHandle.standardError.write(stats.data(using: String.Encoding.utf8)!)
                parent?.totalChunks = 0
                parent?.totalBytes = 0
                parent?.lastStatsTs = now
            }

            // Dump first few seconds to /tmp/sysaudio.wav for diagnosis
            if let p = parent {
                if p.wavBuffer.count < Int(p.wavMaxSeconds * sampleRate) * bytesPerFrame {
                    p.wavBuffer.append(Data(bytes: int16Ptr, count: byteCount))
                    if p.wavBuffer.count >= Int(p.wavMaxSeconds * sampleRate) * bytesPerFrame {
                        // Write WAV once
                        let path = "/tmp/sysaudio.wav"
                        if let wavData = makeWav(pcmData: p.wavBuffer, sampleRate: Int(sampleRate), channels: Int(channels)) {
                            try? wavData.write(to: URL(fileURLWithPath: path))
                            let msg = "{\"status\":\"wav_dumped\",\"path\":\"/tmp/sysaudio.wav\",\"seconds\":\(Int(p.wavMaxSeconds))}\n"
                            FileHandle.standardError.write(msg.data(using: .utf8)!)
                        }
                    }
                }
            }
        }
    }
}

@main
struct Main {
    static func main() async {
        // Print version info
        printVersionInfo()
        
        // Check macOS version
        if #available(macOS 13.0, *) {
            do {
                let dumper = AudioDumper()
                try await dumper.start()
            } catch {
                let s = String(describing: error).replacingOccurrences(of: "\"", with: "'")
                let msg = "{\"error\":\"" + s + "\"}\n"
                FileHandle.standardError.write(msg.data(using: .utf8)!)
                exit(1)
            }
        } else {
            let msg = "{\"error\":\"This application requires macOS 13.0 or later\"}\n"
            FileHandle.standardError.write(msg.data(using: .utf8)!)
            exit(1)
        }
    }
}

   func logAudioFormatDetails(format: AVAudioFormat) {
       let desc = format.streamDescription.pointee
       print("""
           Audio Format Details:
           - Sample Rate: \(format.sampleRate) Hz
           - Channels: \(format.channelCount)
           - Format ID: \(desc.mFormatID)
           - Format Flags: \(desc.mFormatFlags)
           - Bytes Per Packet: \(desc.mBytesPerPacket)
           - Frames Per Packet: \(desc.mFramesPerPacket)
           - Bytes Per Frame: \(desc.mBytesPerFrame)
           - Bits Per Channel: \(desc.mBitsPerChannel)
           """)
   }

   func makeWav(pcmData: Data, sampleRate: Int, channels: Int) -> Data? {
       var header = Data()
       let bitsPerSample = 16
       let byteRate = sampleRate * channels * bitsPerSample / 8
       let blockAlign = channels * bitsPerSample / 8
       let dataSize = UInt32(pcmData.count)
       let riffChunkSize = 36 + dataSize

       func write(_ value: UInt32) { var v = value.littleEndian; header.append(Data(bytes: &v, count: 4)) }
       func write16(_ value: UInt16) { var v = value.littleEndian; header.append(Data(bytes: &v, count: 2)) }

       header.append("RIFF".data(using: .ascii)!)
       write(riffChunkSize)
       header.append("WAVE".data(using: .ascii)!)
       header.append("fmt ".data(using: .ascii)!)
       write(16) // PCM fmt chunk size
       write16(1) // PCM format
       write16(UInt16(channels))
       write(UInt32(sampleRate))
       write(UInt32(byteRate))
       write16(UInt16(blockAlign))
       write16(UInt16(bitsPerSample))
       header.append("data".data(using: .ascii)!)
       write(dataSize)

       var wav = Data()
       wav.append(header)
       wav.append(pcmData)
       return wav
   }
