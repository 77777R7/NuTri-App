import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProfileScreenModel } from './viewModel';

test('buildProfileScreenModel: falls back to preview state with empty input', () => {
  const model = buildProfileScreenModel({
    user: null,
    draft: null,
    isBiometricEnabled: false,
  });

  assert.equal(model.hero.displayName, 'NuTri Member');
  assert.equal(model.hero.secondaryText, 'Local profile preview');
  assert.equal(model.hero.initials, 'N');
  assert.equal(model.hero.overviewState, 'preview');
  assert.equal(model.snapshot.find(item => item.id === 'goals')?.value, null);
  assert.equal(model.preferences.find(item => item.id === 'notifications')?.state, 'not_set');
  assert.equal(model.accountData.find(item => item.id === 'sync')?.state, 'local_only');
});

test('buildProfileScreenModel: derives display name and initials from email', () => {
  const model = buildProfileScreenModel({
    user: { email: 'jane.doe@example.com' },
    draft: null,
    isBiometricEnabled: false,
  });

  assert.equal(model.hero.displayName, 'Jane Doe');
  assert.equal(model.hero.secondaryText, 'jane.doe@example.com');
  assert.equal(model.hero.initials, 'JD');
  assert.equal(model.hero.overviewState, 'connected');
});

test('buildProfileScreenModel: maps onboarding values into snapshot and chips', () => {
  const model = buildProfileScreenModel({
    user: { email: 'profile@example.com' },
    draft: {
      goals: ['Energy', 'Sleep', 'Energy'],
      diets: ['Vegetarian', 'Low sugar'],
      supplementExperience: 'Intermediate',
      location: { city: 'Vancouver', country: 'Canada' },
      preferredTypes: ['Capsules', 'Powder'],
    },
    isBiometricEnabled: false,
  });

  assert.equal(model.snapshot.find(item => item.id === 'goals')?.value, 'Energy, Sleep');
  assert.equal(model.snapshot.find(item => item.id === 'diet')?.value, 'Vegetarian, Low sugar');
  assert.equal(model.snapshot.find(item => item.id === 'experience')?.value, 'Intermediate');
  assert.equal(model.snapshot.find(item => item.id === 'region')?.value, 'Vancouver, Canada');
  assert.deepEqual(
    model.personalization.chips.map(chip => chip.label),
    ['Energy', 'Sleep', 'Capsules', 'Powder'],
  );
  assert.ok(model.personalization.chips.every(chip => chip.preview === false));
});

test('buildProfileScreenModel: maps biometric and consent states into status pills', () => {
  const model = buildProfileScreenModel({
    user: { email: 'secure@example.com' },
    draft: {
      permissionPreferences: {
        notifications: true,
        photos: false,
      },
      privacy: {
        agreed: true,
      },
    },
    isBiometricEnabled: true,
  });

  assert.equal(model.preferences.find(item => item.id === 'biometric')?.state, 'enabled');
  assert.equal(model.preferences.find(item => item.id === 'notifications')?.state, 'allowed');
  assert.equal(model.preferences.find(item => item.id === 'photos')?.state, 'denied');
  assert.equal(model.preferences.find(item => item.id === 'consent')?.state, 'accepted');
});
