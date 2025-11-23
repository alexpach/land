export class AudioController {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        this.midiData = null;
        this.nextNoteTime = 0;
        this.currentNoteIndex = 0;
        this.tempo = 120; // Default, will be read from MIDI
        this.lookahead = 25.0; // How frequently to call scheduling function (in milliseconds)
        this.scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)
        this.timerID = null;
        this.notes = [];
        this.masterGain = null;
        this.isMuted = false;
    }

    async init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async load(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        this.midiData = new Uint8Array(arrayBuffer);
        this.parseMidi();
    }

    parseMidi() {
        // Simple MIDI Parser for Format 0/1
        // This is a simplified parser focusing on Note On/Off events in the first track
        let p = 0;

        // Header Chunk
        const headerChunkType = this.readString(p, 4); p += 4;
        const headerLength = this.readInt32(p); p += 4;
        const format = this.readInt16(p); p += 2;
        const numTracks = this.readInt16(p); p += 2;
        const timeDivision = this.readInt16(p); p += 2;

        // Find first track
        while (p < this.midiData.length) {
            const chunkType = this.readString(p, 4); p += 4;
            const chunkLength = this.readInt32(p); p += 4;

            if (chunkType === 'MTrk') {
                this.parseTrack(p, chunkLength, timeDivision);
                break; // Only parse first track for now
            }
            p += chunkLength;
        }
    }

    parseTrack(start, length, ticksPerQuarter) {
        let p = start;
        const end = start + length;
        let currentTime = 0; // In ticks
        let lastStatus = null;

        this.notes = [];

        while (p < end) {
            const { value: deltaTime, bytesRead } = this.readVarInt(p);
            p += bytesRead;
            currentTime += deltaTime;

            let status = this.midiData[p];
            if (status & 0x80) {
                lastStatus = status;
                p++;
            } else {
                status = lastStatus;
            }

            const type = status & 0xF0;
            const channel = status & 0x0F;

            if (type === 0x90) { // Note On
                const note = this.midiData[p++];
                const velocity = this.midiData[p++];
                if (velocity > 0) {
                    this.notes.push({
                        note: note,
                        startTime: currentTime, // Ticks
                        duration: 0 // Will be filled by Note Off
                    });
                } else {
                    // Note On with velocity 0 is Note Off
                    this.closeNote(note, currentTime);
                }
            } else if (type === 0x80) { // Note Off
                const note = this.midiData[p++];
                const velocity = this.midiData[p++];
                this.closeNote(note, currentTime);
            } else if (type === 0xFF) { // Meta Event
                const metaType = this.midiData[p++];
                const { value: len, bytesRead: lenBytes } = this.readVarInt(p);
                p += lenBytes;

                if (metaType === 0x51) { // Tempo
                    const microsecondsPerQuarter = (this.midiData[p] << 16) | (this.midiData[p + 1] << 8) | this.midiData[p + 2];
                    this.tempo = 60000000 / microsecondsPerQuarter;
                }
                p += len;
            } else {
                // Skip other events (simplified)
                // Note: This might break if there are other variable length events, 
                // but for our generated MIDI it should be fine.
                // A robust parser would handle all event types.
                if (type === 0xC0 || type === 0xD0) p += 1;
                else if (type === 0xB0 || type === 0xE0 || type === 0xA0) p += 2;
            }
        }

        // Convert ticks to seconds
        const secondsPerTick = 60 / this.tempo / ticksPerQuarter;
        this.notes.forEach(n => {
            n.startTime *= secondsPerTick;
            n.duration *= secondsPerTick;
        });
    }

    closeNote(note, endTime) {
        // Find the last open note with this pitch
        for (let i = this.notes.length - 1; i >= 0; i--) {
            if (this.notes[i].note === note && this.notes[i].duration === 0) {
                this.notes[i].duration = endTime - this.notes[i].startTime;
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

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.currentNoteIndex = 0;
        this.songStartTime = undefined; // Will be set in scheduler
        this.scheduler();
    }

    stop() {
        this.isPlaying = false;
        clearTimeout(this.timerID);
    }

    scheduler() {
        // If we haven't started the song time yet, do it now
        if (this.songStartTime === undefined) {
            this.songStartTime = this.audioContext.currentTime + 0.1;
        }

        while (this.currentNoteIndex < this.notes.length &&
            this.songStartTime + this.notes[this.currentNoteIndex].startTime < this.audioContext.currentTime + this.scheduleAheadTime) {
            this.scheduleNote();
        }

        // Loop logic
        if (this.currentNoteIndex >= this.notes.length && this.notes.length > 0) {
            // Check if the last note has finished playing
            const lastNote = this.notes[this.notes.length - 1];
            const lastNoteEndTime = this.songStartTime + lastNote.startTime + lastNote.duration;

            if (this.audioContext.currentTime > lastNoteEndTime + 1.0) { // 1 second pause
                this.currentNoteIndex = 0;
                this.songStartTime = this.audioContext.currentTime + 0.1;
            }
        }

        if (this.isPlaying) {
            this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
        }
    }

    scheduleNote() {
        const note = this.notes[this.currentNoteIndex];
        const absolutePlayTime = this.songStartTime + note.startTime;

        this.playTone(note.note, absolutePlayTime, note.duration);
        this.currentNoteIndex++;
    }

    playTone(midiNote, time, duration) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'square'; // 8-bit sound
        osc.frequency.value = 440 * Math.pow(2, (midiNote - 69) / 12);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + duration);

        // Envelope to avoid clicking
        gain.gain.setValueAtTime(0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + duration - 0.01);
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 1, this.audioContext.currentTime);
        }
        return this.isMuted;
    }
}
