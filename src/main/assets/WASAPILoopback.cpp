// WASAPILoopback.cpp
// Build: cl /O2 /EHsc /Fe:WASAPILoopback.exe WASAPILoopback.cpp ole32.lib uuid.lib avrt.lib
// Emits raw s16le PCM to stdout in fixed 100ms frames (2400 samples @ 24 kHz = 4800 bytes)

#define _CRT_SECURE_NO_WARNINGS
// Avoid Windows.h min/max macros clobbering std::min/std::max
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <avrt.h>
#include <cstdio>
#include <cstdint>
#include <vector>
#include <cmath>
#include <algorithm>
#include <iostream>
#include <io.h>
#include <fcntl.h>
#include <cstring>
#include <functiondiscoverykeys_devpkey.h>

#include <initguid.h>  // keep this include

// Explicit GUID definitions (so we don't need AudioSes/Mmdevapi libs)
DEFINE_GUID(CLSID_MMDeviceEnumerator, 0xBCDE0395,0xE52F,0x467C,0x8E,0x3D,0xC4,0x57,0x92,0x91,0x69,0x2E);
DEFINE_GUID(IID_IMMDeviceEnumerator,  0xA95664D2,0x9614,0x4F35,0xA7,0x46,0xDE,0x8D,0xB6,0x36,0x17,0xE6);
DEFINE_GUID(IID_IAudioClient,         0x1CB9AD4C,0xDBFA,0x4C32,0xB1,0x78,0xC2,0xF5,0x68,0xA7,0x03,0xB2);
DEFINE_GUID(IID_IAudioCaptureClient,  0xC8ADBD64,0xE71E,0x48A0,0xA4,0xDE,0x18,0x5C,0x39,0x5C,0xD3,0x17);


#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")
#pragma comment(lib, "avrt.lib")


// ----- Config -----
static const uint32_t TARGET_RATE   = 24000; // Hz
static const uint32_t TARGET_CHANS  = 1;     // mono
static const uint32_t CHUNK_SAMPLES = 2400;  // samples per 100 ms at 24 kHz
static const size_t   CHUNK_BYTES   = CHUNK_SAMPLES * 2; // s16le

// ----- Simple helpers -----
struct WavFmt {
    WAVEFORMATEXTENSIBLE wfxe;  // do not auto-init here
    bool isFloat;
    bool isExt;
    uint32_t srcRate;
    uint32_t srcChans;

    WavFmt()
        : isFloat(false)
        , isExt(false)
        , srcRate(0)
        , srcChans(0)
    {
        ZeroMemory(&wfxe, sizeof(wfxe));
    }
};

static void fail(const char* msg, HRESULT hr) {
    std::fprintf(stderr, "%s (hr=0x%08X)\n", msg, (unsigned)hr);
    std::exit(1);
}

static void setStdoutBinary() {
    // Make sure stdout is in binary mode (no CRLF munging)
    _setmode(_fileno(stdout), _O_BINARY);
    // Disable buffering so each write flushes immediately
    setvbuf(stdout, nullptr, _IONBF, 0);
}

// Mix multi-channel float to mono float
static void downmixToMono(const float* in, uint32_t frames, uint32_t chans, std::vector<float>& outMono) {
    outMono.resize(frames);
    for (uint32_t i = 0; i < frames; ++i) {
        double acc = 0.0;
        for (uint32_t c = 0; c < chans; ++c) {
            acc += in[i * chans + c];
        }
        outMono[i] = static_cast<float>(acc / std::max<uint32_t>(1, chans));
    }
}

// Very simple linear resampler: from srcRate → TARGET_RATE (mono float)
static void linearResample(const std::vector<float>& inMono, uint32_t srcRate, std::vector<float>& outMono) {
    if (srcRate == TARGET_RATE) {
        outMono = inMono;
        return;
    }
    const double ratio = double(TARGET_RATE) / double(srcRate);
    const size_t outCount = static_cast<size_t>(std::floor(inMono.size() * ratio));
    outMono.resize(outCount);
    for (size_t i = 0; i < outCount; ++i) {
        double srcPos = i / ratio;
        size_t i0 = static_cast<size_t>(std::floor(srcPos));
        size_t i1 = std::min(i0 + 1, inMono.size() - 1);
        double t = srcPos - i0;
        outMono[i] = static_cast<float>((1.0 - t) * inMono[i0] + t * inMono[i1]);
    }
}

// Convert mono float [-1,1] → s16le
static void floatMonoToS16(const std::vector<float>& inMono, std::vector<int16_t>& outS16) {
    outS16.resize(inMono.size());
    for (size_t i = 0; i < inMono.size(); ++i) {
        float x = std::max(-1.0f, std::min(1.0f, inMono[i]));
        int v = (x < 0.f) ? int(x * 32768.f) : int(x * 32767.f);
        outS16[i] = static_cast<int16_t>(v);
    }
}

// Parse WAVEFORMATEX / EXTENSIBLE
static WavFmt parseFormat(const WAVEFORMATEX* wfx) {
    WavFmt F;

    if (wfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
        F.isExt = true;
        const WAVEFORMATEXTENSIBLE* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(wfx);
        memcpy(&F.wfxe, ext, sizeof(WAVEFORMATEXTENSIBLE));
        F.isFloat = (F.wfxe.SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
        F.srcRate = F.wfxe.Format.nSamplesPerSec;
        F.srcChans = F.wfxe.Format.nChannels;
    }
    else {
        F.isExt = false;
        ZeroMemory(&F.wfxe, sizeof(WAVEFORMATEXTENSIBLE));
        F.wfxe.Format = *wfx;
        F.wfxe.SubFormat = (wfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT)
            ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            : KSDATAFORMAT_SUBTYPE_PCM;
        F.isFloat = (wfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT);
        F.srcRate = wfx->nSamplesPerSec;
        F.srcChans = wfx->nChannels;
    }

    return F;
}

// Push PCM16 bytes in exact CHUNK_SAMPLES frames to stdout
static void emitChunks(const std::vector<int16_t>& s16, std::vector<int16_t>& carry) {
    if (!carry.empty()) {
        // prepend carry to new audio
        std::vector<int16_t> tmp;
        tmp.reserve(carry.size() + s16.size());
        tmp.insert(tmp.end(), carry.begin(), carry.end());
        tmp.insert(tmp.end(), s16.begin(), s16.end());
        carry.swap(tmp);
    } else {
        carry = s16;
    }

    size_t offset = 0;
    while (carry.size() - offset >= CHUNK_SAMPLES) {
        const int16_t* p = carry.data() + offset;
        std::fwrite(p, 2, CHUNK_SAMPLES, stdout); // 2 bytes per sample
        offset += CHUNK_SAMPLES;
    }

    // Keep any tail (partial frame) for next round
    if (offset > 0) {
        std::vector<int16_t> tail(carry.begin() + offset, carry.end());
        carry.swap(tail);
    }
}

int main() {
    setStdoutBinary();

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) fail("CoInitializeEx failed", hr);

    // Bump MMCSS priority (optional but recommended)
    DWORD taskIndex = 0;
    HANDLE hAvTask = AvSetMmThreadCharacteristicsA("Pro Audio", &taskIndex);

    IMMDeviceEnumerator* pEnum = nullptr;
    hr = CoCreateInstance(CLSID_MMDeviceEnumerator, nullptr, CLSCTX_ALL,
                          IID_IMMDeviceEnumerator, (void**)&pEnum);
    if (FAILED(hr)) fail("Create MMDeviceEnumerator failed", hr);

    IMMDevice* pDevice = nullptr;
    hr = pEnum->GetDefaultAudioEndpoint(eRender, eConsole, &pDevice);
    if (FAILED(hr)) fail("GetDefaultAudioEndpoint failed", hr);

    IAudioClient* pAudioClient = nullptr;
    hr = pDevice->Activate(IID_IAudioClient, CLSCTX_ALL, nullptr, (void**)&pAudioClient);
    if (FAILED(hr)) fail("Activate(IAudioClient) failed", hr);

    WAVEFORMATEX* pMixWfx = nullptr;
    hr = pAudioClient->GetMixFormat(&pMixWfx);
    if (FAILED(hr)) fail("GetMixFormat failed", hr);
    WavFmt mix = parseFormat(pMixWfx);

    // We capture in shared mode with LOOPBACK flag
    REFERENCE_TIME hnsBufferDuration = 10000000; // 1 second
    hr = pAudioClient->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                  AUDCLNT_STREAMFLAGS_LOOPBACK,
                                  hnsBufferDuration, 0, pMixWfx, nullptr);
    if (FAILED(hr)) fail("IAudioClient::Initialize(LOOPBACK) failed", hr);

    IAudioCaptureClient* pCapture = nullptr;
    hr = pAudioClient->GetService(IID_IAudioCaptureClient, (void**)&pCapture);
    if (FAILED(hr)) fail("GetService(IAudioCaptureClient) failed", hr);

    hr = pAudioClient->Start();
    if (FAILED(hr)) fail("IAudioClient::Start failed", hr);

    // Buffers for processing
    std::vector<float>   interleavedFloat;
    std::vector<float>   monoSrc;
    std::vector<float>   mono24k;
    std::vector<int16_t> s16;
    std::vector<int16_t> carry; // tail partials between callbacks

    // Capture loop
    bool running = true;
    while (running) {
        UINT32 packetFrames = 0;
        hr = pCapture->GetNextPacketSize(&packetFrames);
        if (FAILED(hr)) fail("GetNextPacketSize failed", hr);

        if (packetFrames == 0) {
            // Sleep a tiny bit to avoid busy spin
            Sleep(3);
            continue;
        }

        BYTE* pData = nullptr;
        UINT32 numFrames = 0;
        DWORD flags = 0;
        hr = pCapture->GetBuffer(&pData, &numFrames, &flags, nullptr, nullptr);
        if (FAILED(hr)) fail("GetBuffer failed", hr);

        // Expecting float mix format most of the time
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
            // Emit silence if desired: here we just skip (silence) by pushing zeros
            interleavedFloat.assign(numFrames * mix.srcChans, 0.0f);
        } else {
            // Convert incoming to float interleaved
            // Mix format is commonly float32, but handle PCM16 fallback.
            if (mix.isFloat) {
                const float* pf = reinterpret_cast<const float*>(pData);
                interleavedFloat.assign(pf, pf + (size_t)numFrames * mix.srcChans);
            } else {
                // PCM16 → float
                const int16_t* ps = reinterpret_cast<const int16_t*>(pData);
                interleavedFloat.resize((size_t)numFrames * mix.srcChans);
                for (size_t i = 0; i < interleavedFloat.size(); ++i) {
                    interleavedFloat[i] = ps[i] / 32768.0f;
                }
            }
        }

        pCapture->ReleaseBuffer(numFrames);

        // Downmix to mono
        downmixToMono(interleavedFloat.data(), numFrames, mix.srcChans, monoSrc);

        // Resample to 24k
        linearResample(monoSrc, mix.srcRate, mono24k);

        // Convert to s16
        floatMonoToS16(mono24k, s16);

        // RMS-based silence gate (fast): skip frames with very low energy
        if (!s16.empty()) {
            float rms = 0.f;
            for (auto v : s16) rms += float(v) * float(v);
            rms = std::sqrt(rms / float(s16.size()));
            if (rms < 250.f) {
                // ~ -52 dB threshold for s16 scale; adjust as needed
                continue;
            }
        }

        // Emit in exact CHUNK_SAMPLES frames (keep tail in carry)
        emitChunks(s16, carry);

        // Optional: exit if parent process closed stdout
        if (ferror(stdout)) {
            running = false;
        }

        // Optional: stop if a key is pressed (dev use)
        if (GetAsyncKeyState(VK_ESCAPE) & 0x8000) {
            running = false;
        }
    }

    pAudioClient->Stop();
    if (pMixWfx) CoTaskMemFree(pMixWfx);
    if (pCapture) pCapture->Release();
    if (pAudioClient) pAudioClient->Release();
    if (pDevice) pDevice->Release();
    if (pEnum) pEnum->Release();

    if (hAvTask) AvRevertMmThreadCharacteristics(hAvTask);
    CoUninitialize();
    return 0;
}