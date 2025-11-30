const fs = require('fs');
const path = require('path');

// MIDI Helpers
function stringToBytes(str) {
    return str.split('').map(c => c.charCodeAt(0));
}

function numToBytes(num, bytes) {
    const result = [];
    for (let i = bytes - 1; i >= 0; i--) {
        result.push((num >> (8 * i)) & 0xFF);
    }
    return result;
}

function varIntToBytes(num) {
    let buffer = num & 0x7F;
    while ((num >>= 7)) {
        buffer <<= 8;
        buffer |= ((num & 0x7F) | 0x80);
    }
    const result = [];
    while (true) {
        result.push(buffer & 0xFF);
        if (buffer & 0x80) buffer >>= 8;
        else break;
    }
    return result;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const QUARTER_NOTE = 128;

const NOTES = {
    C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59,
    C4: 60, Cis4: 61, D4: 62, Dis4: 63, E4: 64, F4: 65, Fis4: 66, G4: 67, Gis4: 68, A4: 69, B4: 71,
    C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81
};

// 1. This Land Is Your Land (Chorus)
// C, F, F, A, C5, A, F, C, G, G, B, D5, B, G, E, C
const thisLandMelody = [
    { note: NOTES.C4, duration: 0.5 }, { note: NOTES.F4, duration: 0.5 }, { note: NOTES.F4, duration: 0.5 }, { note: NOTES.A4, duration: 0.5 },
    { note: NOTES.C5, duration: 1.0 }, { note: NOTES.A4, duration: 1.0 },
    { note: NOTES.F4, duration: 0.5 }, { note: NOTES.C4, duration: 0.5 }, { note: NOTES.G4, duration: 1.0 },
    { note: NOTES.G4, duration: 0.5 }, { note: NOTES.B4, duration: 0.5 }, { note: NOTES.D5, duration: 1.0 },
    { note: NOTES.B4, duration: 0.5 }, { note: NOTES.G4, duration: 0.5 }, { note: NOTES.E4, duration: 1.0 },
    { note: NOTES.C4, duration: 2.0 }
];

// 2. Land Down Under (Flute Riff)
// B4, B4, B4, B4, B4, A4, G4, A4, G4, Fis4, D4, E4
const landDownUnderMelody = [
    { note: NOTES.B4, duration: 0.25 }, { note: NOTES.B4, duration: 0.25 }, { note: NOTES.B4, duration: 0.25 }, { note: NOTES.B4, duration: 0.25 },
    { note: NOTES.B4, duration: 0.5 }, { note: NOTES.A4, duration: 0.5 },
    { note: NOTES.G4, duration: 0.5 }, { note: NOTES.A4, duration: 0.5 },
    { note: NOTES.G4, duration: 0.5 }, { note: NOTES.Fis4, duration: 0.5 },
    { note: NOTES.D4, duration: 0.5 }, { note: NOTES.E4, duration: 1.0 }
];

// 3. Promised Land (Chuck Berry Style Riff)
// C4, E4, G4, A4, Bb4, A4, G4, E4 (Blues scaleish)
const promisedLandMelody = [
    { note: NOTES.C4, duration: 0.25 }, { note: NOTES.E4, duration: 0.25 }, { note: NOTES.G4, duration: 0.25 }, { note: NOTES.A4, duration: 0.25 },
    { note: 70, duration: 0.25 }, { note: NOTES.A4, duration: 0.25 }, { note: NOTES.G4, duration: 0.25 }, { note: NOTES.E4, duration: 0.25 },
    { note: NOTES.C4, duration: 0.5 }, { note: NOTES.C4, duration: 0.5 }, { note: NOTES.C4, duration: 1.0 }
];

function createMidiFile(filename, melody, trackName) {
    const trackData = [];
    trackData.push(0x00, 0xFF, 0x03, trackName.length, ...stringToBytes(trackName));
    trackData.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20); // 120 BPM

    melody.forEach(event => {
        const durationTicks = Math.round(event.duration * QUARTER_NOTE);
        trackData.push(0x00, NOTE_ON, event.note, 80);
        trackData.push(...varIntToBytes(durationTicks), NOTE_OFF, event.note, 0);
    });

    trackData.push(0x00, 0xFF, 0x2F, 0x00);

    const header = [
        ...stringToBytes("MThd"), ...numToBytes(6, 4), ...numToBytes(0, 2), ...numToBytes(1, 2), ...numToBytes(QUARTER_NOTE, 2)
    ];
    const trackHeader = [
        ...stringToBytes("MTrk"), ...numToBytes(trackData.length, 4)
    ];

    const fileData = Buffer.from([...header, ...trackHeader, ...trackData]);
    fs.writeFileSync(path.join(__dirname, '../music', filename), fileData);
    console.log(`Generated: ${filename}`);
}

createMidiFile('this_land_is_your_land.mid', thisLandMelody, 'This Land');
createMidiFile('land_down_under.mid', landDownUnderMelody, 'Down Under');
createMidiFile('promised_land.mid', promisedLandMelody, 'Promised Land');
