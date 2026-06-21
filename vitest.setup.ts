import { TextEncoder, TextDecoder } from 'util';

const nodeUint8Array = new TextEncoder().encode("").constructor;
global.Uint8Array = nodeUint8Array as any;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;
