'use strict';

// The colours this CLI uses, in-house. On a plugin install, require('chalk') can resolve
// to an ESM-only chalk 5 in the folder plugins share, and `chalk.blue` is then not a
// function (#39). Colour is not worth a dependency that can crash `install`.

const env = process.env;
const enabled =
  !env.NO_COLOR && env.FORCE_COLOR !== '0' && (Boolean(env.FORCE_COLOR) || Boolean(process.stdout.isTTY));

const style = (open, close) => (text) =>
  enabled ? `\u001b[${open}m${text}\u001b[${close}m` : String(text);

module.exports = {
  red: style(31, 39),
  green: style(32, 39),
  yellow: style(33, 39),
  blue: style(34, 39),
  cyan: style(36, 39),
  dim: style(2, 22),
};
