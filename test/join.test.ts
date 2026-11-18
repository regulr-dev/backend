import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

const joinSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(100),
  email: z.string().trim().email('Please enter a valid email address').max(200),
  birthMonth: z.number().int().min(1).max(12).optional().nullable(),
  birthDay: z.number().int().min(1).max(31).optional().nullable(),
  tapId: z.string().optional(),
});

test('join payload validation accepts valid customer details', () => {
  const valid = joinSchema.parse({
    name: 'Talha Kamran',
    email: 'Talha@Example.COM',
    birthMonth: 5,
    birthDay: 14,
  });
  assert.equal(valid.name, 'Talha Kamran');
  assert.equal(valid.birthMonth, 5);
  assert.equal(valid.birthDay, 14);
});

test('join payload validation allows optional birthday', () => {
  const valid = joinSchema.parse({
    name: 'Customer No Birthday',
    email: 'nobday@example.com',
  });
  assert.equal(valid.name, 'Customer No Birthday');
  assert.equal(valid.birthMonth, undefined);
  assert.equal(valid.birthDay, undefined);
});

test('join payload validation rejects empty name or invalid email', () => {
  assert.throws(() => joinSchema.parse({ name: '', email: 'valid@example.com' }));
  assert.throws(() => joinSchema.parse({ name: 'Valid Name', email: 'invalid-email' }));
});
