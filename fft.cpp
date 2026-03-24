#include "pxt.h"

using namespace pxt;

namespace audioFFT {

// ─── Constants ─────────────────────────────────────────────────────
#define FFT_SIZE        2048
#define HALF_FFT        1024
#define SAMPLE_RATE     11025
#define SAMPLE_PERIOD_US 90ULL   // 1000000 / 11025 ≈ 90 µs

#define PI_F 3.14159265358979f

// ─── Static Buffers (stack is only 2048 bytes — everything here) ──
static float fft_buf[FFT_SIZE * 2];       // 16 KB interleaved [re,im,re,im,...]
static float magnitudes[HALF_FFT + 1];    // ~4 KB magnitude spectrum
static float twiddle_re[HALF_FFT];        // 4 KB cos twiddle factors
static float twiddle_im[HALF_FFT];        // 4 KB sin twiddle factors

// ─── Cached Results ───────────────────────────────────────────────
static int result_primary_freq = 0;
static int result_secondary_freq = 0;
static int result_signal_level = 0;
static bool tables_initialized = false;

// ─── Twiddle Factor Initialisation (called once) ──────────────────
static void initTwiddles() {
    if (tables_initialized) return;
    for (int i = 0; i < HALF_FFT; i++) {
        float angle = -2.0f * PI_F * (float)i / (float)FFT_SIZE;
        twiddle_re[i] = cosf(angle);
        twiddle_im[i] = sinf(angle);
    }
    tables_initialized = true;
}

// ─── Bit-Reversal Permutation ─────────────────────────────────────
static void bitReverse(float* buf, int n) {
    int j = 0;
    for (int i = 0; i < n - 1; i++) {
        if (i < j) {
            float tmp_re = buf[2 * i];
            float tmp_im = buf[2 * i + 1];
            buf[2 * i]     = buf[2 * j];
            buf[2 * i + 1] = buf[2 * j + 1];
            buf[2 * j]     = tmp_re;
            buf[2 * j + 1] = tmp_im;
        }
        int m = n >> 1;
        while (m >= 1 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }
}

// ─── Radix-2 Cooley-Tukey DIT FFT ────────────────────────────────
static void fftCompute(float* buf, int n) {
    bitReverse(buf, n);

    for (int size = 2; size <= n; size *= 2) {
        int halfsize = size / 2;
        int stride = n / size;

        for (int i = 0; i < n; i += size) {
            for (int k = 0; k < halfsize; k++) {
                int even_idx = 2 * (i + k);
                int odd_idx  = 2 * (i + k + halfsize);
                int tw_idx   = k * stride;

                float tw_re = twiddle_re[tw_idx];
                float tw_im = twiddle_im[tw_idx];

                float odd_re = buf[odd_idx];
                float odd_im = buf[odd_idx + 1];

                float product_re = odd_re * tw_re - odd_im * tw_im;
                float product_im = odd_re * tw_im + odd_im * tw_re;

                buf[odd_idx]     = buf[even_idx]     - product_re;
                buf[odd_idx + 1] = buf[even_idx + 1] - product_im;
                buf[even_idx]     += product_re;
                buf[even_idx + 1] += product_im;
            }
        }
    }
}

// ─── ADC Sampling — 2048 samples from pin1 at ~11,025 Hz ─────────
static int sampleADC() {
    auto pin = LOOKUP_PIN(P1);
    int lo = 1023, hi = 0;
    long total = 0;

    for (int i = 0; i < FFT_SIZE; i++) {
        uint64_t t0 = system_timer_current_time_us();

        int val = pin->getAnalogValue();
        if (val < lo) lo = val;
        if (val > hi) hi = val;
        total += val;

        fft_buf[2 * i]     = (float)val;
        fft_buf[2 * i + 1] = 0.0f;

        // Busy-wait to maintain sample rate
        while ((system_timer_current_time_us() - t0) < SAMPLE_PERIOD_US)
            /* spin */;
    }

    // DC removal — subtract mean from all real parts
    float mean = (float)total / (float)FFT_SIZE;
    for (int i = 0; i < FFT_SIZE; i++) {
        fft_buf[2 * i] -= mean;
    }

    return hi - lo;
}

// ─── Hanning Window ───────────────────────────────────────────────
static void applyHanningWindow() {
    float factor = 2.0f * PI_F / (float)(FFT_SIZE - 1);
    for (int i = 0; i < FFT_SIZE; i++) {
        float w = 0.5f * (1.0f - cosf(factor * (float)i));
        fft_buf[2 * i] *= w;
    }
}

// ─── Magnitude Spectrum ───────────────────────────────────────────
static void computeMagnitudes() {
    for (int i = 0; i <= HALF_FFT; i++) {
        float re = fft_buf[2 * i];
        float im = fft_buf[2 * i + 1];
        magnitudes[i] = sqrtf(re * re + im * im);
    }
}

// ─── Harmonic Suppression ─────────────────────────────────────────
static bool isHarmonic(float f1, float f2) {
    if (f1 < 1.0f) return true;
    float ratio = f2 / f1;
    const float harmonics[] = {0.5f, 1.0f, 2.0f, 3.0f, 0.333f};
    for (int i = 0; i < 5; i++) {
        if (fabsf(ratio - harmonics[i]) < 0.08f) return true;
    }
    return false;
}

// ─── Peak Detection ───────────────────────────────────────────────
static void findPeaks(int peakToPeak) {
    float freqRes = (float)SAMPLE_RATE / (float)FFT_SIZE;  // ~5.38 Hz

    // Frequency range: just below C3 (130.81) to just above B5 (987.77)
    int minBin = (int)(120.0f / freqRes);   // ~22
    int maxBin = (int)(1050.0f / freqRes);  // ~195
    if (maxBin > HALF_FFT) maxBin = HALF_FFT;

    // Primary peak
    float maxMag = 0;
    int maxBinIdx = 0;
    for (int i = minBin; i <= maxBin; i++) {
        if (magnitudes[i] > maxMag) {
            maxMag = magnitudes[i];
            maxBinIdx = i;
        }
    }

    // Parabolic interpolation for sub-bin accuracy
    float refinedBin = (float)maxBinIdx;
    if (maxBinIdx > minBin && maxBinIdx < maxBin) {
        float alpha = magnitudes[maxBinIdx - 1];
        float beta  = magnitudes[maxBinIdx];
        float gamma = magnitudes[maxBinIdx + 1];
        float denom = alpha - 2.0f * beta + gamma;
        if (fabsf(denom) > 0.0001f) {
            refinedBin += 0.5f * (alpha - gamma) / denom;
        }
    }
    float primaryFreq = refinedBin * freqRes;
    result_primary_freq = (int)(primaryFreq + 0.5f);

    // Secondary peak — non-harmonic, >= 30% of primary magnitude
    float threshold = maxMag * 0.3f;
    float secondMax = 0;
    int secondBinIdx = 0;

    for (int i = minBin; i <= maxBin; i++) {
        if (i >= maxBinIdx - 3 && i <= maxBinIdx + 3) continue;  // skip near primary
        if (magnitudes[i] > secondMax && magnitudes[i] >= threshold) {
            float freq = (float)i * freqRes;
            if (!isHarmonic(primaryFreq, freq)) {
                secondMax = magnitudes[i];
                secondBinIdx = i;
            }
        }
    }

    if (secondBinIdx > 0) {
        // Parabolic interpolation on secondary peak
        float refinedSecond = (float)secondBinIdx;
        if (secondBinIdx > minBin && secondBinIdx < maxBin) {
            float a = magnitudes[secondBinIdx - 1];
            float b = magnitudes[secondBinIdx];
            float g = magnitudes[secondBinIdx + 1];
            float d = a - 2.0f * b + g;
            if (fabsf(d) > 0.0001f) {
                refinedSecond += 0.5f * (a - g) / d;
            }
        }
        result_secondary_freq = (int)(refinedSecond * freqRes + 0.5f);
    } else {
        result_secondary_freq = 0;
    }

    // Signal level: 0–100 scale
    result_signal_level = (peakToPeak * 100) / 1023;
    if (result_signal_level > 100) result_signal_level = 100;
}

// ─── PXT Shim Functions (exposed to TypeScript) ───────────────────

//%
void runAnalysis() {
    initTwiddles();
    int pp = sampleADC();
    applyHanningWindow();
    fftCompute(fft_buf, FFT_SIZE);
    computeMagnitudes();
    findPeaks(pp);
}

//%
int primaryFrequency() {
    return result_primary_freq;
}

//%
int secondaryFrequency() {
    return result_secondary_freq;
}

//%
int signalLevel() {
    return result_signal_level;
}

}  // namespace audioFFT
