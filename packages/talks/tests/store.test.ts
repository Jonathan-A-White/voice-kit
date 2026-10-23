import { createMemoryStore } from '../src/index.js';
import { createFakeTalkStore } from '../../testing/src/talks.js';
import { storeContract } from './storeContract.js';

storeContract('the in-memory store', () => createMemoryStore());
// the fake an app's tests use (@voice-kit/testing) keeps the same contract
storeContract('the fake store of @voice-kit/testing', () => createFakeTalkStore());
