import {clientModule, serverModule, isInteractive} from './strip.mjs';
export default function (source) {
  if (isInteractive(source)) return source;
  const name = this._compiler?.name;
  if (name === 'client') return clientModule(source);
  if (name === 'server') return serverModule(source);
  throw new Error('Unsupported compiler');
}
