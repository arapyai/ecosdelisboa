import { ApiError, type AdminManagedUser } from '@ecosdelisboa/shared';

export function formatAdminCreatedAt(value: string) {
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function canDeleteAdmin(user: AdminManagedUser, currentUserId: string) {
  return user.id !== currentUserId;
}

export function adminUserError(cause: unknown) {
  if (cause instanceof ApiError && cause.status === 409) {
    return 'Esta ação entra em conflito com outro usuário ou com as proteções de acesso.';
  }
  if (cause instanceof ApiError && cause.status === 422) {
    return 'Confira o email e use uma senha com pelo menos 12 caracteres.';
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}
