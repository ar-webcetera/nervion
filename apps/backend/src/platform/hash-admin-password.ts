import { hashIdentityPassword } from './password';

// Read from stdin so the password is never an argument in shell history/process lists.
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk: string) => {
  input += chunk;
  if (input.length > 1024) {
    console.error('Password input is too long');
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
process.stdin.on('end', () => {
  if (process.exitCode) return;
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12 || password.length > 256) {
    console.error('Password must contain 12-256 characters');
    process.exitCode = 1;
    return;
  }
  console.log(hashIdentityPassword(password));
});
