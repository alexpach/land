export class AudioController {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        this.midiData = null;
        this.currentNoteIndex = 0;
        this.baseTempo = 230; // Default BPM
        this.currentTempo = 230;
        this.ticksPerQuarter = 128; // Default, will be read from MIDI
        this.lookahead = 25.0; // ms
        this.scheduleAheadTime = 0.1; // sec
        this.timerID = null;
        this.notes = []; // Stores { note, startTicks, durationTicks }
        this.totalTicks = 0;
        this.masterGain = null;
        this.isMuted = false;
        this.songStartTime = 0;
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
        this.stop();
        if (!url) return;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            this.midiData = new Uint8Array(arrayBuffer);
            this.parseMidi();
            console.log("Music Loaded Successfully");
        } catch (e) {
            console.error("Music Load Error:", e);
            alert(`Music Error: ${e.message}`);
        }
    }

    parseMidi() {
        let p = 0;

        // Header Chunk
        const headerChunkType = this.readString(p, 4); p += 4;
        const headerLength = this.readInt32(p); p += 4;
        const format = this.readInt16(p); p += 2;
        const numTracks = this.readInt16(p); p += 2;
        this.ticksPerQuarter = this.readInt16(p); p += 2;

        let bestTrackNotes = [];
        let maxNoteCount = -1;

        // Iterate through all tracks
        for (let i = 0; i < numTracks; i++) {
            // Find next track chunk
            while (p < this.midiData.length) {
                const chunkType = this.readString(p, 4); p += 4;
                const chunkLength = this.readInt32(p); p += 4;

                if (chunkType === 'MTrk') {
                    const trackNotes = this.parseTrack(p, chunkLength);

                    if (trackNotes.length > maxNoteCount) {
                        maxNoteCount = trackNotes.length;
                        bestTrackNotes = trackNotes;
                    }
                    p += chunkLength;
                    break; // Move to next track iteration
                } else {
                    p += chunkLength; // Skip unknown chunks
                }
            }
        }

        this.notes = bestTrackNotes;
        this.processNotes();
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
                // Only update running status for Voice Channel Messages (0x80 - 0xEF)
                // System Messages (0xF0 - 0xFF) do NOT affect running status in SMF usually, 
                // or at least they shouldn't be used as running status.
                if (status < 0xF0) {
                    lastStatus = status;
                }
            } else {
                // Running Status
                status = lastStatus;
                isRunningStatus = true;
            }

            if (!status) {
                // Should not happen if file is valid
                console.warn("Missing status byte and no running status");
                p++;
                continue;
            }

            const type = status & 0xF0;

            if (type === 0x90) { // Note On
                const note = this.midiData[p++];
                const velocity = this.midiData[p++];
                if (velocity > 0) {
                    trackNotes.push({
                        note: note,
                        startTicks: currentTicks,
                        durationTicks: 0
                    });
                } else {
                    this.closeTrackNote(trackNotes, note, currentTicks);
                }
            } else if (type === 0x80) { // Note Off
                const note = this.midiData[p++];
                const velocity = this.midiData[p++];
                this.closeTrackNote(trackNotes, note, currentTicks);
            } else if (type === 0xF0) { // System Messages (Sysex, Meta)
                if (status === 0xFF) { // Meta Event
                    const metaType = this.midiData[p++];
                    const { value: len, bytesRead: lenBytes } = this.readVarInt(p);
                    p += lenBytes;
                    p += len; // Skip Meta Event Data
                } else if (status === 0xF0 || status === 0xF7) { // Sysex
                    const { value: len, bytesRead: lenBytes } = this.readVarInt(p);
                    p += lenBytes;
                    p += len; // Skip Sysex Data
                } else {
                    // Other System Common/Realtime (shouldn't be in SMF tracks usually, but skip if found)
                    // 0xF1, 0xF3: 1 byte data
                    // 0xF2: 2 bytes data
                    // 0xF6, 0xF8-0xFE: 0 bytes data
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

    processNotes() {
        if (this.notes.length === 0) {
            this.totalTicks = 0;
            return;
        }

        // 1. Find min start tick (Leading Silence)
        let minTick = this.notes[0].startTicks;
        this.notes.forEach(n => {
            if (n.startTicks < minTick) minTick = n.startTicks;
        });

        // 2. Trim Silence
        this.notes.forEach(n => {
            n.startTicks -= minTick;
        });

        // 3. Calculate Total Ticks (Length)
        this.totalTicks = 0;
        this.notes.forEach(n => {
            const end = n.startTicks + n.durationTicks;
            if (end > this.totalTicks) this.totalTicks = end;
        });

        // Add a small buffer at the end (e.g., a quarter note) to let the last note ring out slightly?
        // Or just keep it tight. User complained about gap, so tight is better.
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
        this.currentTempo = 230; // Start at 230 BPM
        this.songStartTime = undefined;
        this.scheduler();
    }

    stop() {
        this.isPlaying = false;
        if (this.timerID) {
            clearTimeout(this.timerID);
            this.timerID = null;
        }
        if (this.masterGain) {
            this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            if (!this.isMuted) {
                this.masterGain.gain.setTargetAtTime(1, this.audioContext.currentTime + 0.1, 0.1);
            }
        }
    }

    scheduler() {
        if (this.songStartTime === undefined) {
            this.songStartTime = this.audioContext.currentTime + 0.1;
        }

        const secondsPerTick = 60 / this.currentTempo / this.ticksPerQuarter;

        while (this.currentNoteIndex < this.notes.length) {
            const note = this.notes[this.currentNoteIndex];
            const noteTime = this.songStartTime + (note.startTicks * secondsPerTick);

            if (noteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
                this.playTone(note.note, noteTime, note.durationTicks * secondsPerTick);
                this.currentNoteIndex++;
            } else {
                break;
            }
        }

        // Loop Logic
        if (this.currentNoteIndex >= this.notes.length && this.notes.length > 0) {
            // Calculate when the current loop ends
            const loopDuration = this.totalTicks * secondsPerTick;
            const loopEndTime = this.songStartTime + loopDuration;

            // If we are close to the end of the loop, schedule the next loop
            if (loopEndTime < this.audioContext.currentTime + this.scheduleAheadTime) {
                // Update Start Time for next loop
                this.songStartTime = loopEndTime;
                this.currentNoteIndex = 0;

                // Randomly change tempo (+/- 20 BPM)
                const change = Math.random() < 0.5 ? -20 : 20;
                this.currentTempo += change;

                // Clamp tempo to reasonable limits (e.g., 60 - 400)
                if (this.currentTempo < 60) this.currentTempo = 60;
                if (this.currentTempo > 400) this.currentTempo = 400;

                console.log(`Looping! New Tempo: ${this.currentTempo} BPM`);
            }
        }

        if (this.isPlaying) {
            this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
        }
    }

    playTone(midiNote, time, duration) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'square';
        osc.frequency.value = 440 * Math.pow(2, (midiNote - 69) / 12);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + duration);

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
