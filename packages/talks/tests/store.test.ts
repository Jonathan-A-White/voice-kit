import { createMemoryStore } from '../src/index.js';
import { storeContract } from './storeContract.js';

storeContract('the in-memory store', () => createMemoryStore());
