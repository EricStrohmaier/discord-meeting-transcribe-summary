import { BotState } from '../types';

const state: BotState = {
  currentMeeting: null,
  connection: null,
  recordingProcess: null,
  mixingInterval: null,
  userBuffers: null,
  userStreams: null,
  meetings: [],
};

export default state;
