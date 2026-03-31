// ─── Note Frequency Table: natural notes C2 through B7 ─────────────
// 7 natural notes per octave, 6 octaves = 42 entries
// Index % 7 maps to: 0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B
const NOTE_FREQS = [
    260, 292, 328, 348, 392, 440, 492,   // octave 4
    520, 584, 656, 696, 784, 880, 984   // octave 5
]

// ─── Pre-allocated font bitmaps (7 notes × 5 rows) ─────────────
// Flat array: FONT[(noteIdx % 7) * 5 + row] = 4-bit row bitmask
// No per-call array allocation — everything is a const lookup
const FONT = [
    //  C
    0b0111, 0b1000, 0b1000, 0b1000, 0b0111,
    //  D
    0b1110, 0b1001, 0b1001, 0b1001, 0b1110,
    //  E
    0b1111, 0b1000, 0b1110, 0b1000, 0b1111,
    //  F
    0b1111, 0b1000, 0b1110, 0b1000, 0b1000,
    //  G
    0b0111, 0b1000, 0b1011, 0b1001, 0b0111,
    //  A
    0b0110, 0b1001, 0b1111, 0b1001, 0b1001,
    //  B
    0b1110, 0b1001, 0b1110, 0b1001, 0b1110
]

// ─── Tuneable Constants ──────────────────────────────────────────
const TRIGGER_LEVEL = 30   // peak-to-peak ADC threshold (0-1023 from quickLevel)
const SUSTAIN_COUNT = 3
const QUIET_RESET = 2
const FREQ_TOLERANCE_PCT = 5
const QUIET_CLEAR_MS = 500

// ─── State (all integers — zero heap allocation) ─────────────────
let loudCount = 0
let quietCount = 0
let lastNoteTime = 0
let displayedIdx = -1   // index into NOTE_FREQS, -1 = none
let displayedFreq = 0   // Hz value for A+B debug display
let gNoteCount = 0      // Number of times note G is detected

// ─── Startup: let ADC/mic settle before listening ────────────────
basic.pause(1000)
/**
 * Find nearest note index. Returns -1 if no match within tolerance.
 * Zero heap allocation — only integer arithmetic.
 */
function freqToNote(freq: number): number {
    if (freq < 260 || freq > 1000) return -1
    let bestIdx = 0
    let bestDist = 99999
    for (let i = 0; i < NOTE_FREQS.length; i++) {
        let dist = Math.abs(freq - NOTE_FREQS[i])
        if (dist < bestDist) {
            bestDist = dist
            bestIdx = i
        }
    }
    if (bestDist * 100 > NOTE_FREQS[bestIdx] * FREQ_TOLERANCE_PCT) return -1
    return bestIdx
}

/**
 * Render note on LED matrix (cols 0-3, rows 0-4).
 * Uses flat FONT[] const lookup — no array allocation.
 * Pass -1 to clear display.
 */
function showNote(noteIdx: number): void {
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 4; x++) {
            led.unplot(x, y)
        }
    }
    if (noteIdx < 0) return
    let fontBase = (noteIdx % 7) * 5
    for (let y2 = 0; y2 < 5; y2++) {
        let row = FONT[fontBase + y2]
        for (let x2 = 0; x2 < 4; x2++) {
            if (row & (1 << (3 - x2))) {
                led.plot(x2, y2)
            }
        }
    }
}

// ─── A+B button: show detected frequency in Hz (debug) ──────────
input.onButtonPressed(Button.AB, function () {
    if (displayedFreq > 0) {
        basic.showNumber(displayedFreq)
        if (displayedIdx >= 0) {
            showNote(displayedIdx)
        }
    }
})

// ─── Main Loop ───────────────────────────────────────────────────
basic.forever(function () {
    // Quick sound level check — uses same ADC path as FFT (no CODAL audio contention)
    let level = audioFFT.quickLevel()

    if (level > TRIGGER_LEVEL) {
        loudCount += 1
        quietCount = 0
    } else {
        quietCount += 1
        if (quietCount >= QUIET_RESET) {
            loudCount = 0
        }
    }

    if (loudCount >= SUSTAIN_COUNT) {
        loudCount = 0
        quietCount = 0

        audioFFT.runAnalysis()

        let pFreq = audioFFT.primaryFrequency()
        let idx = freqToNote(pFreq)
        if (idx >= 0) {
            // Count G note detections (idx % 7 == 4 is G)
            if (idx % 7 === 4 && displayedIdx % 7 !== 4) {
                gNoteCount += 1
                if (gNoteCount >= 3) {
                    control.inBackground(function () {
                        pins.digitalWritePin(DigitalPin.P16, 1)
                        basic.pause(3000)
                        pins.digitalWritePin(DigitalPin.P16, 0)
                    })
                    control.inBackground(function () {
                        basic.pause(500)
                        pins.digitalWritePin(DigitalPin.P1, 1)
                        basic.pause(3000)
                        pins.digitalWritePin(DigitalPin.P1, 0)
                    })
                    control.inBackground(function () {
                        basic.pause(1000)
                        pins.digitalWritePin(DigitalPin.P2, 1)
                        basic.pause(3000)
                        pins.digitalWritePin(DigitalPin.P2, 0)
                    })
                    control.inBackground(function () {
                        basic.pause(1500)
                        pins.digitalWritePin(DigitalPin.P8, 1)
                        basic.pause(3000)
                        pins.digitalWritePin(DigitalPin.P8, 0)
                    })

                    gNoteCount = 0 // Reset counter for the next time
                }
            } else if (idx % 7 !== 4) {
                gNoteCount = 0
            }

            displayedIdx = idx
            displayedFreq = pFreq
            lastNoteTime = input.runningTime()
            showNote(idx)
        }
    }

    // Clear after silence
    if (displayedIdx >= 0 && input.runningTime() - lastNoteTime > QUIET_CLEAR_MS) {
        displayedIdx = -1
        displayedFreq = 0
        showNote(-1)
    }

    basic.pause(20)
})
