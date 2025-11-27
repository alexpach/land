const fs = require('fs');
const path = require('path');

class MidiDebugger {
    constructor(filePath) {
        this.midiData = fs.readFileSync(filePath);
        this.notes = [];
        this.totalTicks = 0;
        this.ticksPerQuarter = 0;
    }

    parseMidi() {
        let p = 0;

        // Header Chunk
        const headerChunkType = this.readString(p, 4); p += 4;
        const headerLength = this.readInt32(p); p += 4;
        const format = this.readInt16(p); p += 2;
        const numTracks = this.readInt16(p); p += 2;
        this.ticksPerQuarter = this.readInt16(p); p += 2;

        console.log(`MIDI Header: Format=${format}, Tracks=${numTracks}, Ticks=${this.ticksPerQuarter}`);

        let bestTrackNotes = [];
        let maxNoteCount = -1;

        // Iterate through all tracks
        for (let i = 0; i < numTracks; i++) {
            // Find next track chunk
            while (p < this.midiData.length) {
                const chunkType = this.readString(p, 4); p += 4;
                const chunkLength = this.readInt32(p); p += 4;

                if (chunkType === 'MTrk') {
                    console.log(`Parsing Track ${i}, Length: ${chunkLength}, Offset: ${p}`);
                    try {
                        const trackNotes = this.parseTrack(p, chunkLength);
                        console.log(`Track ${i} Notes: ${trackNotes.length}`);

                        if (trackNotes.length > maxNoteCount) {
                            maxNoteCount = trackNotes.length;
                            bestTrackNotes = trackNotes;
                        }
                    } catch (e) {
                        console.error(`Error parsing track ${i}:`, e.message);
                    }
                    p += chunkLength;
                    break; // Move to next track iteration
                } else {
                    console.log(`Skipping chunk: ${chunkType}`);
                    p += chunkLength; // Skip unknown chunks
                }
            }
        }

        console.log(`Best Track has ${bestTrackNotes.length} notes.`);
    }

    parseTrack(start, length) {
        let p = start;
        const end = start + length;
        let currentTicks = 0;
        let lastStatus = null;
        const trackNotes = [];

        while (p < end) {
            const { value: deltaTime, bytesRead } = this.readVarInt(p);
            p += bytesRead;
            currentTicks += deltaTime;

            let status = this.midiData[p];
            let isRunningStatus = false;

            if (status & 0x80) {
                // New Status Byte
                p++;
                if (status < 0xF0) {
                    lastStatus = status;
                }
            } else {
                // Running Status
                if (lastStatus === null) {
                    throw new Error(`Running status used but no last status at offset ${p}`);
                }
                status = lastStatus;
                isRunningStatus = true;
            }

            const type = status & 0xF0;

            if (type === 0x90) { // Note On
                const note = this.midiData[p++];
                const velocity = this.midiData[p++];
                if (velocity > 0) {
                    trackNotes.push({ note, startTicks: currentTicks, durationTicks: 0 });
                } else {
                    this.closeTrackNote(trackNotes, note, currentTicks);
                }
            } else if (type === 0x80) { // Note Off
                const note = this.midiData[p++];
                const velocity = this.midiData[p++];
                this.closeTrackNote(trackNotes, note, currentTicks);
            } else if (type === 0xF0) { // System Messages
                if (status === 0xFF) { // Meta Event
                    const metaType = this.midiData[p++];
                    const { value: len, bytesRead: lenBytes } = this.readVarInt(p);
                    p += lenBytes;
                    p += len;
                } else if (status === 0xF0 || status === 0xF7) { // Sysex
                    const { value: len, bytesRead: lenBytes } = this.readVarInt(p);
                    p += lenBytes;
                    p += len;
                } else {
                    if (status === 0xF1 || status === 0xF3) p += 1;
                    else if (status === 0xF2) p += 2;
                }
            } else {
                // Control Change, Program Change, etc.
                if (type === 0xC0 || type === 0xD0) p += 1;
                else if (type === 0xB0 || type === 0xE0 || type === 0xA0) p += 2;
            }
        }
        return trackNotes;
    }

    closeTrackNote(trackNotes, note, endTicks) {
        for (let i = trackNotes.length - 1; i >= 0; i--) {
            if (trackNotes[i].note === note && trackNotes[i].durationTicks === 0) {
                trackNotes[i].durationTicks = endTicks - trackNotes[i].startTicks;
                break;
            }
        }
    }

    readString(offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.midiData[offset + i]);
        }
        return str;
    }

    readInt32(offset) {
        return (this.midiData[offset] << 24) | (this.midiData[offset + 1] << 16) | (this.midiData[offset + 2] << 8) | this.midiData[offset + 3];
    }

    readInt16(offset) {
        return (this.midiData[offset] << 8) | this.midiData[offset + 1];
    }

    readVarInt(offset) {
        let value = 0;
        let bytesRead = 0;
        let byte;
        do {
            byte = this.midiData[offset + bytesRead];
            value = (value << 7) | (byte & 0x7F);
            bytesRead++;
        } while (byte & 0x80);
        return { value, bytesRead };
    }
}

const filePath = path.join(__dirname, '../public/music/country_roads.mid');
console.log(`Debugging MIDI file: ${filePath}`);
const midiDebugger = new MidiDebugger(filePath);
midiDebugger.parseMidi();
