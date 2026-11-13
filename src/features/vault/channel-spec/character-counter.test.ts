import { describe, expect, it } from 'vitest';
import {
  countCodepoints,
  countGraphemes,
  countLength,
  countThreadsLength,
  countUtf8Bytes,
  countUtf16CodeUnits,
} from './character-counter';

describe('character-counter', () => {
  describe('countUtf16CodeUnits (string.length)', () => {
    it('counts ascii and hangul as 1 unit per char', () => {
      expect(countUtf16CodeUnits('hello')).toBe(5);
      expect(countUtf16CodeUnits('안녕하세요')).toBe(5);
    });

    it('counts surrogate pair emojis as 2 units', () => {
      expect(countUtf16CodeUnits('😀')).toBe(2);
      expect(countUtf16CodeUnits('🚀')).toBe(2);
    });

    it('counts ZWJ composite emoji as sum of surrogate units', () => {
      // 👨‍👩‍👧‍👦 = 👨(2) + ZWJ(1) + 👩(2) + ZWJ(1) + 👧(2) + ZWJ(1) + 👦(2) = 11
      expect(countUtf16CodeUnits('👨‍👩‍👧‍👦')).toBe(11);
    });
  });

  describe('countCodepoints ([...str].length)', () => {
    it('counts basic text and hangul as 1 codepoint per char', () => {
      expect(countCodepoints('hello')).toBe(5);
      expect(countCodepoints('안녕하세요')).toBe(5);
    });

    it('counts single emoji as 1 codepoint', () => {
      expect(countCodepoints('😀')).toBe(1);
      expect(countCodepoints('🚀')).toBe(1);
    });

    it('counts ZWJ emoji sequence by each codepoint including ZWJ', () => {
      // 4 emojis + 3 ZWJs = 7 codepoints
      expect(countCodepoints('👨‍👩‍👧‍👦')).toBe(7);
      // 👍🏽 = 👍(1) + modifier(1) = 2 codepoints
      expect(countCodepoints('👍🏽')).toBe(2);
    });
  });

  describe('countGraphemes (Intl.Segmenter visually perceived char)', () => {
    it('counts hangul and basic text by visual characters', () => {
      expect(countGraphemes('hello')).toBe(5);
      expect(countGraphemes('안녕하세요')).toBe(5);
    });

    it('counts single emoji as 1 grapheme', () => {
      expect(countGraphemes('😀')).toBe(1);
      expect(countGraphemes('🚀')).toBe(1);
    });

    it('counts ZWJ sequence family emoji as 1 grapheme', () => {
      expect(countGraphemes('👨‍👩‍👧‍👦')).toBe(1);
    });

    it('counts skin tone modified emoji as 1 grapheme', () => {
      expect(countGraphemes('👍🏽')).toBe(1);
    });

    it('counts job emoji (woman technologist) as 1 grapheme', () => {
      expect(countGraphemes('👩‍💻')).toBe(1);
    });
  });

  describe('countUtf8Bytes', () => {
    it('measures UTF-8 byte length correctly', () => {
      expect(countUtf8Bytes('abc')).toBe(3); // 1 byte each
      expect(countUtf8Bytes('한글')).toBe(6); // 3 bytes each
      expect(countUtf8Bytes('😀')).toBe(4); // 4 bytes for SMP emoji
    });
  });

  describe('countThreadsLength (Threads official API: text codepoints + emoji as UTF-8 bytes)', () => {
    it('counts regular ASCII and Hangul by codepoint', () => {
      expect(countThreadsLength('Hello')).toBe(5);
      expect(countThreadsLength('스레드')).toBe(3);
    });

    it('counts simple emoji by its UTF-8 byte length (4 bytes)', () => {
      // '😀' is 4 bytes in UTF-8
      expect(countThreadsLength('😀')).toBe(4);
      // '안녕😀' = 안(1) + 녕(1) + 😀(4) = 6
      expect(countThreadsLength('안녕😀')).toBe(6);
    });

    it('counts composite ZWJ emoji by full UTF-8 byte representation', () => {
      // 👨‍👩‍👧‍👦 in UTF-8: 👨(4) + ZWJ(3) + 👩(4) + ZWJ(3) + 👧(4) + ZWJ(3) + 👦(4) = 25 bytes
      const zwjBytes = countUtf8Bytes('👨‍👩‍👧‍👦');
      expect(countThreadsLength('👨‍👩‍👧‍👦')).toBe(zwjBytes);
    });
  });

  describe('countLength dispatcher', () => {
    const text = '소희 AI 🚀';

    it('dispatches to chosen strategy', () => {
      expect(countLength(text, 'grapheme')).toBe(7); // '소','희',' ','A','I',' ','🚀'
      expect(countLength(text, 'codepoint')).toBe(7);
      expect(countLength(text, 'utf16_code_units')).toBe(8); // 🚀 is 2 code units
      expect(countLength(text, 'utf8_bytes')).toBe(14); // '소'(3) + '희'(3) + ' '(1) + 'A'(1) + 'I'(1) + ' '(1) + '🚀'(4) = 14
      expect(countLength(text, 'threads_hybrid')).toBe(10); // 6 regular chars (each 1) + 🚀(4 bytes) = 10
    });
  });
});
