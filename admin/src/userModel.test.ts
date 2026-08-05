import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, type AdminManagedUser } from '@ecosdelisboa/shared';
import { adminUserError, canDeleteAdmin, confirmsAdminEmail, formatAdminCreatedAt } from './users/userModel.ts';

const user: AdminManagedUser = {
  id: 'user-1',
  email: 'admin@example.com',
  is_active: true,
  created_at: '2026-08-05T12:30:00Z'
};

test('prevents deleting the current administrator', () => {
  assert.equal(canDeleteAdmin(user, 'user-1'), false);
  assert.equal(canDeleteAdmin(user, 'user-2'), true);
});

test('requires the target email before confirming permanent deletion', () => {
  assert.equal(confirmsAdminEmail('admin@example.com', 'admin@example.com'), true);
  assert.equal(confirmsAdminEmail('admin@example.com', ' ADMIN@EXAMPLE.COM '), true);
  assert.equal(confirmsAdminEmail('admin@example.com', 'another@example.com'), false);
});

test('formats creation timestamps for the Portuguese interface', () => {
  assert.match(formatAdminCreatedAt(user.created_at), /05\/08\/2026/);
});

test('maps API validation and conflict responses to useful messages', () => {
  assert.match(adminUserError(new ApiError('conflict', 409, '/users')), /conflito/);
  assert.match(adminUserError(new ApiError('invalid', 422, '/users')), /12 caracteres/);
});
