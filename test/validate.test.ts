import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src';
import { assertExternalId } from '../src/core/validate';

describe('assertExternalId', () => {
  it('accepts a simple alphanumeric id', () => {
    expect(() => assertExternalId('alice_123')).not.toThrow();
  });

  it('accepts a UUID', () => {
    expect(() => assertExternalId('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
  });

  it('accepts special URL-safe characters', () => {
    expect(() => assertExternalId('user:alice@org')).not.toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => assertExternalId('')).toThrow(ConfigError);
  });

  it('rejects whitespace', () => {
    expect(() => assertExternalId('alice 123')).toThrow(ConfigError);
    expect(() => assertExternalId('alice\t123')).toThrow(ConfigError);
    expect(() => assertExternalId('alice\n123')).toThrow(ConfigError);
  });

  it('rejects forward slash', () => {
    expect(() => assertExternalId('alice/123')).toThrow(ConfigError);
  });

  it('rejects backslash', () => {
    expect(() => assertExternalId('alice\\123')).toThrow(ConfigError);
  });

  it('rejects strings longer than 255 characters', () => {
    expect(() => assertExternalId('a'.repeat(256))).toThrow(ConfigError);
  });

  it('accepts exactly 255 characters', () => {
    expect(() => assertExternalId('a'.repeat(255))).not.toThrow();
  });
});
