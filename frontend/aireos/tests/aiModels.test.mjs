// Wording for a Gemini model that is no longer available (backend ai_models).
// Run with `npm test` -- Node's built-in test runner, no extra packages.
// The bell rebuilds the backend's sentence from the notification payload, so a
// change to either side's wording (or a payload rename) fails these tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  joinWords,
  modelFeaturesText,
  modelImpactSentence,
  modelNotice,
  modelToastText,
  modelUnavailableSentence,
} from '../app/utils/aiModels.js';

// ---- Joining names ----

describe('joinWords', () => {
  test('joins one, two and three names the way the backend does', () => {
    assert.equal(joinWords(['A']), 'A');
    assert.equal(joinWords(['A', 'B']), 'A and B');
    assert.equal(joinWords(['A', 'B', 'C']), 'A, B and C');
  });

  test('an empty or missing list is an empty string', () => {
    assert.equal(joinWords([]), '');
    assert.equal(joinWords(undefined), '');
  });
});

describe('modelFeaturesText', () => {
  test('names features the way staff know them', () => {
    assert.equal(modelFeaturesText(['mapping', 'assistant']), 'Nomenclature generation and Assistant');
  });
});

// ---- The bell's sentence ----

describe('modelUnavailableSentence', () => {
  test('matches backend ai_models.unavailable_message for a model both features use', () => {
    const payload = {
      current_model: 'gemini-3.8-flash',
      features: ['mapping', 'assistant'],
      settings: ['MAPPING_MODEL', 'GEMINI_ASSISTANT_MODEL'],
    };

    assert.equal(
      modelUnavailableSentence(payload),
      "The AI model gemini-3.8-flash is no longer available. It's used by Nomenclature generation and Assistant. " +
        'To fix this, update MAPPING_MODEL and GEMINI_ASSISTANT_MODEL to a current Gemini model and redeploy.',
    );
  });

  test('names one feature and one setting when only one uses the model', () => {
    const payload = { current_model: 'gemini-old', features: ['mapping'], settings: ['MAPPING_MODEL'] };

    assert.equal(
      modelUnavailableSentence(payload),
      "The AI model gemini-old is no longer available. It's used by Nomenclature generation. " +
        'To fix this, update MAPPING_MODEL to a current Gemini model and redeploy.',
    );
  });
});

// ---- The bell's short wording ----

describe('modelImpactSentence', () => {
  test('says what stops working for both features, then what to change', () => {
    const payload = { features: ['mapping', 'assistant'], settings: ['MAPPING_MODEL', 'GEMINI_ASSISTANT_MODEL'] };

    assert.equal(
      modelImpactSentence(payload),
      "The Assistant can't answer questions. New upload layouts have to be mapped by hand. " +
        'To fix this, update MAPPING_MODEL and GEMINI_ASSISTANT_MODEL to a current Gemini model and redeploy.',
    );
  });

  test('the assistant alone', () => {
    assert.equal(
      modelImpactSentence({ features: ['assistant'], settings: ['GEMINI_ASSISTANT_MODEL'] }),
      "The Assistant can't answer questions. To fix this, update GEMINI_ASSISTANT_MODEL to a current Gemini model and redeploy.",
    );
  });
});

// ---- The pages' notices ----

const MESSAGE = "The AI model gemini-old is no longer available. It's used by Nomenclature generation and Assistant.";

describe('modelNotice', () => {
  test('nothing while the model is available or the status has not loaded', () => {
    assert.equal(modelNotice(null, 'mapping'), null);
    assert.equal(modelNotice({ mapping: { available: true, message: null } }, 'mapping'), null);
  });

  test('mapping gets one quiet line with the full message as its detail', () => {
    const notice = modelNotice({ mapping: { available: false, message: MESSAGE } }, 'mapping');

    assert.match(notice.text, /mapped by hand/);
    assert.equal(notice.detail, MESSAGE);
  });

  test('the assistant says it is unavailable, with the full message as detail', () => {
    const notice = modelNotice({ assistant: { available: false, message: MESSAGE } }, 'assistant');

    assert.equal(notice.text, 'The Assistant is unavailable');
    assert.equal(notice.detail, MESSAGE);
  });
});

// ---- The upload toast ----

describe('modelToastText', () => {
  test('says mapping must be done by hand when only the mapping model is retired', () => {
    assert.equal(modelToastText(null), 'AI mapping unavailable: map by hand');
    assert.equal(modelToastText({ assistant: { available: true } }), 'AI mapping unavailable: map by hand');
  });

  test('names both models when the Assistant model is retired too', () => {
    assert.equal(modelToastText({ assistant: { available: false } }), 'Mapping and Assistant models outdated');
  });
});
