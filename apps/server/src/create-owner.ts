// Create (or reset) an owner account for a real deployment:
//   npm run create-owner -w apps/server -- <username> <password> [pin] ["Full name"]
import { createUser, hashSecret } from './auth.ts';
import { openDb } from './db.ts';

const [username, password, pin, name] = process.argv.slice(2);
if (!username || !password || password.length < 6) {
  console.error('Usage: npm run create-owner -- <username> <password(min 6)> [pin 4-8 digits] ["Full name"]');
  process.exit(1);
}
const db = openDb(process.env.DB_PATH ?? './data/shopflow.db');
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
if (existing) {
  db.prepare("UPDATE users SET role = 'owner', active = 1, password_hash = ?, pin_hash = COALESCE(?, pin_hash) WHERE id = ?").run(
    hashSecret(password), pin ? hashSecret(pin) : null, existing.id as string,
  );
  console.log(`Updated ${username} as owner`);
} else {
  createUser(db, { username: username.toLowerCase(), name: name ?? username, role: 'owner', password, pin });
  console.log(`Created owner ${username}`);
}
