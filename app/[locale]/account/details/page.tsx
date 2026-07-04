'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';
import Button from '@/components/ui/Button';

export default function AccountDetailsPage() {
  const t = useTranslations('account.details');
  const { user, token, setUser, logout } = useAuthStore();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profileData, setProfileData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [deleteData, setDeleteData] = useState({
    password: '',
    confirmText: '',
  });

  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfileData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordData((prev) => ({ ...prev, [name]: value }));
    if (passwordErrors[name]) {
      setPasswordErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleDeleteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDeleteData((prev) => ({ ...prev, [name]: value }));
    if (deleteErrors[name]) {
      setDeleteErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setIsUploadingAvatar(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', user.id.toString());

      const response = await fetch('/api/upload/avatar', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('toastAvatarFailed'));
      }

      // Update local state
      setUser({
        ...user,
        avatarUrl: data.avatarUrl,
      });

      setMessage({ type: 'success', text: t('toastAvatarSuccess') });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('toastAvatarFailed'),
      });
    } finally {
      setIsUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/customers/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          first_name: profileData.firstName,
          last_name: profileData.lastName,
          email: profileData.email,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('toastProfileFailed'));
      }

      // Update local state
      setUser({
        ...user,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        email: profileData.email,
        displayName: `${profileData.firstName} ${profileData.lastName}`,
      });

      setIsEditingProfile(false);
      setMessage({ type: 'success', text: t('toastProfileSuccess') });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('toastProfileFailed'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const validatePassword = () => {
    const errors: Record<string, string> = {};

    if (!passwordData.currentPassword) {
      errors.currentPassword = t('errorCurrentPasswordRequired');
    }

    if (!passwordData.newPassword) {
      errors.newPassword = t('errorNewPasswordRequired');
    } else if (passwordData.newPassword.length < 12) {
      errors.newPassword = t('errorPasswordTooShort');
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      errors.confirmPassword = t('errorPasswordsMismatch');
    }

    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChangePassword = async () => {
    if (!user?.id || !validatePassword()) return;

    setIsSaving(true);
    setMessage(null);

    try {
      // First verify current password
      const verifyResponse = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: user.id,
          password: passwordData.currentPassword,
        }),
      });

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || !verifyData.valid) {
        setPasswordErrors({ currentPassword: t('errorIncorrectPassword') });
        setIsSaving(false);
        return;
      }

      // Update password
      const response = await fetch(`/api/customers/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          password: passwordData.newPassword,
        }),
      });

      if (!response.ok) {
        throw new Error(t('toastPasswordFailed'));
      }

      setIsChangingPassword(false);
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setMessage({ type: 'success', text: t('toastPasswordSuccess') });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('toastPasswordFailed'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const validateDelete = () => {
    const errors: Record<string, string> = {};

    if (!deleteData.password) {
      errors.password = t('errorDeletePasswordRequired');
    }

    if (deleteData.confirmText !== 'DELETE') {
      errors.confirmText = t('errorDeleteConfirmRequired');
    }

    setDeleteErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleDeleteAccount = async () => {
    if (!user?.id || !validateDelete()) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/customers/${user.id}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          password: deleteData.password,
          confirmText: deleteData.confirmText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('toastDeleteFailed'));
      }

      // Log out and redirect
      logout();
      window.location.href = '/';
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('toastDeleteFailed'),
      });
      setIsSaving(false);
    }
  };

  return (
    <AccountLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t('heading')}</h1>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-success/10 border border-success/20 text-success'
                : 'bg-destructive/10 border border-destructive/20 text-destructive'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Profile Information */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h2 className="heading-plain font-semibold text-foreground">{t('profileSection')}</h2>
            {!isEditingProfile && (
              <button
                onClick={() => setIsEditingProfile(true)}
                className="text-sm text-primary hover:text-primary-hover font-medium cursor-pointer"
              >
                {t('edit')}
              </button>
            )}
          </div>
          <div className="p-6">
            {isEditingProfile ? (
              <div className="space-y-4 max-w-md">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('firstName')}
                    </label>
                    <input
                      type="text"
                      name="firstName"
                      value={profileData.firstName}
                      onChange={handleProfileChange}
                      className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('lastName')}
                    </label>
                    <input
                      type="text"
                      name="lastName"
                      value={profileData.lastName}
                      onChange={handleProfileChange}
                      className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('email')}
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={profileData.email}
                    onChange={handleProfileChange}
                    className="w-full px-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button onClick={handleSaveProfile} disabled={isSaving}>
                    {isSaving ? t('saving') : t('saveChanges')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsEditingProfile(false);
                      setProfileData({
                        firstName: user?.firstName || '',
                        lastName: user?.lastName || '',
                        email: user?.email || '',
                      });
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="relative group">
                    <div
                      onClick={handleAvatarClick}
                      className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center cursor-pointer overflow-hidden transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2"
                    >
                      {isUploadingAvatar ? (
                        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"></div>
                      ) : user?.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.displayName}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-bold text-primary">
                          {user?.firstName?.charAt(0) || 'U'}
                        </span>
                      )}
                    </div>
                    <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <svg
                        className="w-6 h-6 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{user?.displayName}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                    <button
                      onClick={handleAvatarClick}
                      className="text-sm text-primary hover:text-primary-hover font-medium mt-1 cursor-pointer"
                    >
                      {t('changePhoto')}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 pt-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('firstName')}</p>
                    <p className="font-medium text-foreground">{user?.firstName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('lastName')}</p>
                    <p className="font-medium text-foreground">{user?.lastName}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">{t('email')}</p>
                    <p className="font-medium text-foreground">{user?.email}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Password */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h2 className="heading-plain font-semibold text-foreground">{t('passwordSection')}</h2>
            {!isChangingPassword && (
              <button
                onClick={() => setIsChangingPassword(true)}
                className="text-sm text-primary hover:text-primary-hover font-medium cursor-pointer"
              >
                {t('changePassword')}
              </button>
            )}
          </div>
          <div className="p-6">
            {isChangingPassword ? (
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('currentPassword')}
                  </label>
                  <input
                    type="password"
                    name="currentPassword"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
                      passwordErrors.currentPassword ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {passwordErrors.currentPassword && (
                    <p className="mt-1 text-sm text-destructive">{passwordErrors.currentPassword}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('newPassword')}
                  </label>
                  <input
                    type="password"
                    name="newPassword"
                    value={passwordData.newPassword}
                    onChange={handlePasswordChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
                      passwordErrors.newPassword ? 'border-destructive' : 'border-input'
                    }`}
                    placeholder={t('newPasswordPlaceholder')}
                  />
                  {passwordErrors.newPassword && (
                    <p className="mt-1 text-sm text-destructive">{passwordErrors.newPassword}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('confirmNewPassword')}
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
                      passwordErrors.confirmPassword ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {passwordErrors.confirmPassword && (
                    <p className="mt-1 text-sm text-destructive">{passwordErrors.confirmPassword}</p>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <Button onClick={handleChangePassword} disabled={isSaving}>
                    {isSaving ? t('changing') : t('changePassword')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsChangingPassword(false);
                      setPasswordData({
                        currentPassword: '',
                        newPassword: '',
                        confirmPassword: '',
                      });
                      setPasswordErrors({});
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {t('passwordSecurityHint')}
              </p>
            )}
          </div>
        </div>

        {/* Delete Account */}
        <div className="bg-card border border-destructive/20 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-destructive/20">
            <h2 className="heading-plain font-semibold text-destructive">{t('dangerZone')}</h2>
          </div>
          <div className="p-6">
            {isDeletingAccount ? (
              <div className="space-y-4 max-w-md">
                <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
                  <p className="text-sm text-destructive font-medium">
                    {t('deleteWarning')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('enterPassword')}
                  </label>
                  <input
                    type="password"
                    name="password"
                    value={deleteData.password}
                    onChange={handleDeleteChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-destructive bg-background text-foreground ${
                      deleteErrors.password ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {deleteErrors.password && (
                    <p className="mt-1 text-sm text-destructive">{deleteErrors.password}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t.rich('typeDeleteToConfirm', {
                      // Bold the literal word DELETE inside the sentence
                      strong: (chunks) => <span className="font-bold">{chunks}</span>,
                    })}
                  </label>
                  <input
                    type="text"
                    name="confirmText"
                    value={deleteData.confirmText}
                    onChange={handleDeleteChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-destructive bg-background text-foreground ${
                      deleteErrors.confirmText ? 'border-destructive' : 'border-input'
                    }`}
                    placeholder={t('typeDeletePlaceholder')}
                  />
                  {deleteErrors.confirmText && (
                    <p className="mt-1 text-sm text-destructive">{deleteErrors.confirmText}</p>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="destructive"
                    onClick={handleDeleteAccount}
                    disabled={isSaving}
                  >
                    {isSaving ? t('deleting') : t('deleteMyAccount')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsDeletingAccount(false);
                      setDeleteData({ password: '', confirmText: '' });
                      setDeleteErrors({});
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground mb-4">
                  {t('deleteAccountHint')}
                </p>
                <button
                  onClick={() => setIsDeletingAccount(true)}
                  className="px-6 py-2.5 border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/10 transition-colors text-xs font-bold uppercase tracking-[0.12em] cursor-pointer"
                >
                  {t('deleteAccount')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
