const fs = require('fs');
const path = require('path');

// MIDI File Format Helpers
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

// MIDI Constants
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const QUARTER_NOTE = 128; // Ticks per quarter note

// Notes (C4 = 60)
const NOTES = {
    C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71,
    C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83
};

// "This Land Is My Land" Melody (Simplified)
// Key: C Major
// Time Signature: 4/4
const melody = [
    // This land is your land
    { note: NOTES.C4, duration: 0.5 }, { note: NOTES.D4, duration: 0.5 }, { note: NOTES.E4, duration: 1.5 }, { note: NOTES.E4, duration: 0.5 }, { note: NOTES.E4, duration: 1 },

    // This land is my land
    { note: NOTES.D4, duration: 0.5 }, { note: NOTES.C4, duration: 0.5 }, { note: NOTES.D4, duration: 1.5 }, { note: NOTES.D4, duration: 0.5 }, { note: NOTES.D4, duration: 1 },

    // From California
    { note: NOTES.C4, duration: 0.5 }, { note: NOTES.D4, duration: 0.5 }, { note: NOTES.E4, duration: 1.5 }, { note: NOTES.E4, duration: 0.5 }, { note: NOTES.E4, duration: 1 },

    // To the New York Island
    { note: NOTES.F4, duration: 0.5 }, { note: NOTES.G4, duration: 0.5 }, { note: NOTES.A4, duration: 1.5 }, { note: NOTES.A4, duration: 0.5 }, { note: NOTES.A4, duration: 1 },

    // From the red wood forest
    { note: NOTES.G4, duration: 0.5 }, { note: NOTES.F4, duration: 0.5 }, { note: NOTES.E4, duration: 1.5 }, { note: NOTES.E4, duration: 0.5 }, { note: NOTES.E4, duration: 1 },

    // To the Gulf Stream waters
    { note: NOTES.D4, duration: 0.5 }, { note: NOTES.C4, duration: 0.5 }, { note: NOTES.D4, duration: 1.5 }, { note: NOTES.D4, duration: 0.5 }, { note: NOTES.D4, duration: 1 },

    // This land was made for you and me
    { note: NOTES.C4, duration: 0.5 }, { note: NOTES.D4, duration: 0.5 }, { note: NOTES.E4, duration: 1 }, { note: NOTES.D4, duration: 1 }, { note: NOTES.C4, duration: 2 },
];

function createMidiTrack(events) {
    const trackData = [];

    // Track Name: "Melody"
    trackData.push(0x00, 0xFF, 0x03, 0x06, ...stringToBytes("Melody"));

    // Tempo: 120 BPM (500,000 microseconds per quarter note)
    trackData.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);

    let currentTime = 0;

    events.forEach(event => {
        const durationTicks = event.duration * QUARTER_NOTE;

        // Note On
        trackData.push(...varIntToBytes(0)); // Delta time 0
        trackData.push(NOTE_ON, event.note, 64); // Velocity 64

        // Note Off (after duration)
        trackData.push(...varIntToBytes(durationTicks)); // Delta time = duration
        trackData.push(NOTE_OFF, event.note, 0);
    });

    // End of Track
    trackData.push(0x00, 0xFF, 0x2F, 0x00);

    return trackData;
}

function generateMidiFile() {
    const header = [
        ...stringToBytes("MThd"),
        ...numToBytes(6, 4), // Header length
        ...numToBytes(1, 2), // Format 1 (multiple tracks) - actually Format 0 is simpler for single track
        ...numToBytes(1, 2), // Number of tracks
        ...numToBytes(QUARTER_NOTE, 2) // Time division
    ];

    // Change to Format 0 for simplicity
    header[9] = 0;

    const trackData = createMidiTrack(melody);
    const trackHeader = [
        ...stringToBytes("MTrk"),
        ...numToBytes(trackData.length, 4)
    ];

    const fileData = Buffer.from([...header, ...trackHeader, ...trackData]);

    const outputPath = path.join(__dirname, '../public/music/this_land.mid');
    fs.writeFileSync(outputPath, fileData);
    console.log(`MIDI file generated at: ${outputPath}`);
}

generateMidiFile();
