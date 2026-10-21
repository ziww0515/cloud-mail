import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { dbInit } from '../src/init/init';

it('upgrades only new v3.1-v3.3 fields/indexes and preserves legacy rows with safe defaults', async () => {
  const tables = [
    'CREATE TABLE setting (id INTEGER PRIMARY KEY, legacy_marker TEXT)',
    'CREATE TABLE email (email_id INTEGER PRIMARY KEY, user_id INTEGER, account_id INTEGER, type INTEGER, is_del INTEGER, name TEXT, subject TEXT, to_email TEXT, send_email TEXT, status INTEGER, create_time TEXT, text TEXT)',
    'CREATE TABLE star (user_id INTEGER, email_id INTEGER)',
    'CREATE TABLE user (email TEXT, create_time TEXT, type INTEGER)',
    'CREATE TABLE account (user_id INTEGER, is_del INTEGER, sort INTEGER, account_id INTEGER)',
    'CREATE TABLE attachments (email_id INTEGER, type INTEGER)',
    'CREATE TABLE role_perm (role_id INTEGER)',
    'CREATE TABLE oauth (oauth_user_id INTEGER, user_id INTEGER)',
    "INSERT INTO setting (id,legacy_marker) VALUES (1,'keep-existing-settings')",
    "INSERT INTO email (email_id,text) VALUES (1,'keep-existing-mail')"
  ];
  await env.db.batch(tables.map(sql => env.db.prepare(sql)));
  const context = { env };
  await dbInit.v3_1DB(context);
  await dbInit.v3_2DB(context);
  await dbInit.v3_3DB(context);
  const setting = await env.db.prepare('SELECT * FROM setting WHERE id = 1').first();
  expect(setting.legacy_marker).toBe('keep-existing-settings');
  expect(setting.sync_delete).toBe(1);
  expect(setting.auto_clean_days).toBe(0);
  for (const name of ['linuxdo_switch','github_switch','google_switch','webhook_status']) expect(setting[name]).toBe(1);
  expect((await env.db.prepare('SELECT text FROM email WHERE email_id = 1').first()).text).toBe('keep-existing-mail');
  const columns = await env.db.prepare('PRAGMA table_info(oauth)').all();
  expect(columns.results.some(column => column.name === 'platform')).toBe(true);
  const index = await env.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_email_create_time'").first();
  expect(index.name).toBe('idx_email_create_time');
});
