const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const OpenAI = require('openai');
const config = require('config');
const state = require('./state');

const getAudioDuration = async (filePath) => {
  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn(ffmpeg, [
      '-i', filePath,
      '-f', 'null', '-'
    ]);

    let duration = 0;
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if(durationMatch) {
        const hours = parseFloat(durationMatch[1]);
        const minutes = parseFloat(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
    });

    ffmpegProcess.on('close', (code) => {
      if(code === 0) {
        resolve(duration);
      } else {
        reject(new Error('Failed to get audio duration'));
      }
    });

    ffmpegProcess.on('error', (err) => {
      reject(err);
    });
  });
};

module.exports = {
  async cleanupRecording() {
    if(state.mixingInterval) {
      clearInterval(state.mixingInterval);
      state.mixingInterval = null;
    }
  
    if(state.userBuffers && state.recordingProcess) {
      const chunkSize = 48000 * 2 * (20 / 1000);
      const mixedBuffer = Buffer.alloc(chunkSize);
      const mixedSamples = new Int16Array(mixedBuffer.buffer, mixedBuffer.byteOffset, chunkSize / 2);
      mixedSamples.fill(0);
  
      for(const [, user] of state.userBuffers) {
        const available = user.buffer.length - user.position;
        if(available > 0) {
          const chunk = user.buffer.subarray(user.position, user.position + available);
          const userSamples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
          for(let i = 0; i < userSamples.length; i++) {
            const sum = mixedSamples[i] + userSamples[i];
            mixedSamples[i] = Math.max(-32768, Math.min(32767, sum));
          }
        }
      }
  
      if(!state.recordingProcess.stdin.destroyed) 
        state.recordingProcess.stdin.write(mixedBuffer);
    }
  
    if(state.recordingProcess) {
      if(!state.recordingProcess.stdin.destroyed)
        state.recordingProcess.stdin.end();
  
      await new Promise((resolve) => {
        state.recordingProcess.on('close', resolve);
      });
  
      state.recordingProcess = null;
    }
  
    if(state.userStreams) {
      for(const [, streamInfo] of state.userStreams) {
        if(streamInfo.audioStream) streamInfo.audioStream.destroy();
        if(streamInfo.opusDecoder) streamInfo.opusDecoder.destroy();
        if(streamInfo.pcmStream) streamInfo.pcmStream.destroy();
      }
      state.userStreams.clear();
      state.userStreams = null;
    }
  
    if(state.userBuffers) {
      state.userBuffers.clear();
      state.userBuffers = null;
    }
  
    if(state.connection) {
      state.connection.destroy();
      state.connection = null;
    }
  },

  convertOggToMp3: async (oggPath, mp3Path) => {
    return new Promise((resolve, reject) => {
      const ffmpegProcess = spawn(ffmpeg, [
        '-i', oggPath,
        '-codec:a', 'libmp3lame',
        '-q:a', '2',
        '-y',
        mp3Path,
      ]);

      ffmpegProcess.on('close', (code) => {
        if(code === 0) {
          console.log('OGG to MP3 conversion complete.');
          resolve();
        } else {
          console.error('OGG to MP3 conversion failed!');
          reject(new Error('FFmpeg conversion failed'));
        }
      });

      ffmpegProcess.on('error', (err) => {
        console.error('FFmpeg conversion error:', err);
        reject(err);
      });
    });
  },

  splitAudioFile: async (filePath, maxFileSize_MB) => {
    const maxFileSize_Bytes = maxFileSize_MB * 1024 * 1024;
    const fileExtension = path.extname(filePath).toLowerCase();
  
    if(fileExtension !== '.mp3')
      throw new Error('Unsupported file format. Only MP3 files are supported.');
  
    if(!fs.existsSync(filePath))
      throw new Error('File does not exist.');
  
    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;
  
    if(fileSize <= maxFileSize_Bytes)
      return [filePath];
  
    const duration = await getAudioDuration(filePath);
    const partDuration = (maxFileSize_Bytes / fileSize) * duration;
  
    const partFiles = [];
    let startTime = 0;
  
    const baseName = path.basename(filePath, fileExtension);
    const dirName = path.dirname(filePath);
  
    while(startTime < duration) {
      const partFilePath = path.join(
        dirName,
        `${baseName}_part${partFiles.length + 1}${fileExtension}`
      );
  
      const ffmpegProcess = spawn(ffmpeg, [
        '-i', filePath,
        '-ss', startTime.toFixed(2),
        '-t', partDuration.toFixed(2),
        '-c', 'copy',
        '-y',
        partFilePath,
      ]);

      await new Promise((resolve, reject) => {
        ffmpegProcess.on('close', (code) => {
          if(code === 0) {
            partFiles.push(partFilePath);
            resolve();
          } else {
            reject(new Error('FFmpeg split failed'));
          }
        });
  
        ffmpegProcess.on('error', (err) => {
          reject(err);
        });
      });
  
      startTime += partDuration;
    }
  
    return partFiles;
  },

  transcribe: async (audioParts) => {
    let fullTranscription = '';

    if(!process.env.OPENAI_API_KEY)
      throw new Error('Missing OPENAI_API_KEY');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
      for(const filePath of audioParts) {
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: config.get('openai.transcription_model'),
          language: config.get('openai.transcription_language'),
        });

        fullTranscription += transcription.text + ' ';
        if(audioParts.length > 1) fs.unlinkSync(filePath);
      }

      return fullTranscription.trim();
    } catch(e) {
      console.error('Error transcribing audio:', e.message);
      throw new Error('Transcription failed');
    }
  },

  summarize: async (transcriptionPath) => {
    try {
      const transcription = fs.readFileSync(transcriptionPath, 'utf-8');

      const messages = [
        { role: 'system', content: config.get('openai.system_content').join('') },
        { role: 'user', content: `${config.get('openai.user_content')}${transcription}` },
      ];

      if(!process.env.OPENAI_API_KEY)
        throw new Error('Missing OPENAI_API_KEY');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const response = await openai.chat.completions.create({
        model: config.get('openai.summary_model'),
        messages: messages,
      });

      return response.choices[0].message.content;
    } catch(e) {
      console.error('Error while summarizing:', e.message);
      throw new Error('Summary failed');
    }
  },

  sendSummary: async (message, thread) => {
    const lines = message.split('\n');
    let messageChunk = '';

    for(const line of lines) {
      if((messageChunk + '\n' + line).length > 2000) {
        await thread.send(messageChunk);
        messageChunk = line;
      } else {
        messageChunk += (messageChunk ? '\n' : '') + line;
      }
    }
    if(messageChunk) {
      await thread.send(messageChunk);
    }
  },
};
