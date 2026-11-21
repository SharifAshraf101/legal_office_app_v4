// The one piece of Node's Buffer the Worker uses (nodejs_compat provides it at
// run time; the Worker's tsconfig has no Node typings).
declare module 'node:buffer' {
  export const Buffer: {
    from(data: ArrayBufferLike, byteOffset?: number, length?: number): { toString(encoding: 'base64'): string };
  };
}
