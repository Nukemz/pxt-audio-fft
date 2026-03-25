/**
 * Audio FFT frequency analysis for micro:bit V2.
 * Wraps a native C++ 512-point radix-2 FFT that samples from the built-in microphone.
 */
//% color=#0078D7 icon="\uf130" weight=90
namespace audioFFT {

    /**
     * Sample 512 points from the built-in microphone at 8,000 Hz, apply a Hanning window,
     * run a 512-point FFT, and detect the strongest frequency peak.
     * Blocks for approximately 70 ms.
     */
    //% block="run audio analysis"
    //% shim=audioFFT::runAnalysis
    export function runAnalysis(): void {
        return
    }

    /**
     * Get the primary (strongest) detected frequency in Hz.
     * Call runAnalysis() first.
     */
    //% block="primary frequency (Hz)"
    //% shim=audioFFT::primaryFrequency
    export function primaryFrequency(): number {
        return 440
    }

    /**
     * Get the signal level as a percentage (0–100).
     * Call runAnalysis() first.
     */
    //% block="signal level"
    //% shim=audioFFT::signalLevel
    export function signalLevel(): number {
        return 50
    }
}
