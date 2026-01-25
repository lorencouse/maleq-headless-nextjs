'use client';

import { useState, useRef } from 'react';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';

export default function AccountDetailsPage() {
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
        throw new Error(data.error || 'Failed to upload avatar');
      }

      // Update local state
      setUser({
        ...user,
        avatarUrl: data.avatarUrl,
      });

      setMessage({ type: 'success', text: 'Avatar updated successfully!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to upload avatar',
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
        throw new Error(data.error || 'Failed to update profile');
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
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update profile',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const validatePassword = () => {
    const errors: Record<string, string> = {};

    if (!passwordData.currentPassword) {
      errors.currentPassword = 'Current password is required';
    }

    if (!passwordData.newPassword) {
      errors.newPassword = 'New password is required';
    } else if (passwordData.newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters';
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
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
        setPasswordErrors({ currentPassword: 'Incorrect current password' });
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
        throw new Error('Failed to change password');
      }

      setIsChangingPassword(false);
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setMessage({ type: 'success', text: 'Password changed successfully!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change password',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const validateDelete = () => {
    const errors: Record<string, string> = {};

    if (!deleteData.password) {
      errors.password = 'Password is required';
    }

    if (deleteData.confirmText !== 'DELETE') {
      errors.confirmText = 'Please type DELETE to confirm';
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
        throw new Error(data.error || 'Failed to delete account');
      }

      // Log out and redirect
      logout();
      window.location.href = '/';
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete account',
      });
      setIsSaving(false);
    }
  };

  return (
    <AccountLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Account Details</h1>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Profile Information */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h2 className="font-semibold text-foreground">Profile Information</h2>
            {!isEditingProfile && (
              <button
                onClick={() => setIsEditingProfile(true)}
                className="text-sm text-primary hover:text-primary-hover font-medium cursor-pointer"
              >
                Edit
              </button>
            )}
          </div>
          <div className="p-6">
            {isEditingProfile ? (
              <div className="space-y-4 max-w-md">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      First Name
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
                      Last Name
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
                    Email Address
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
                  <button
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingProfile(false);
                      setProfileData({
                        firstName: user?.firstName || '',
                        lastName: user?.lastName || '',
                        email: user?.email || '',
                      });
                    }}
                    className="px-6 py-2.5 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground cursor-pointer"
                  >
                    Cancel
                  </button>
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
                      Change photo
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 pt-4">
                  <div>
                    <p className="text-sm text-muted-foreground">First Name</p>
                    <p className="font-medium text-foreground">{user?.firstName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Last Name</p>
                    <p className="font-medium text-foreground">{user?.lastName}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Email Address</p>
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
            <h2 className="font-semibold text-foreground">Password</h2>
            {!isChangingPassword && (
              <button
                onClick={() => setIsChangingPassword(true)}
                className="text-sm text-primary hover:text-primary-hover font-medium cursor-pointer"
              >
                Change Password
              </button>
            )}
          </div>
          <div className="p-6">
            {isChangingPassword ? (
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    name="currentPassword"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
                      passwordErrors.currentPassword ? 'border-red-500' : 'border-input'
                    }`}
                  />
                  {passwordErrors.currentPassword && (
                    <p className="mt-1 text-sm text-red-500">{passwordErrors.currentPassword}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    name="newPassword"
                    value={passwordData.newPassword}
                    onChange={handlePasswordChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
                      passwordErrors.newPassword ? 'border-red-500' : 'border-input'
                    }`}
                    placeholder="At least 8 characters"
                  />
                  {passwordErrors.newPassword && (
                    <p className="mt-1 text-sm text-red-500">{passwordErrors.newPassword}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground ${
                      passwordErrors.confirmPassword ? 'border-red-500' : 'border-input'
                    }`}
                  />
                  {passwordErrors.confirmPassword && (
                    <p className="mt-1 text-sm text-red-500">{passwordErrors.confirmPassword}</p>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleChangePassword}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? 'Changing...' : 'Change Password'}
                  </button>
                  <button
                    onClick={() => {
                      setIsChangingPassword(false);
                      setPasswordData({
                        currentPassword: '',
                        newPassword: '',
                        confirmPassword: '',
                      });
                      setPasswordErrors({});
                    }}
                    className="px-6 py-2.5 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                For security, we recommend changing your password regularly.
              </p>
            )}
          </div>
        </div>

        {/* Delete Account */}
        <div className="bg-card border border-red-200 dark:border-red-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-red-200 dark:border-red-800">
            <h2 className="font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
          </div>
          <div className="p-6">
            {isDeletingAccount ? (
              <div className="space-y-4 max-w-md">
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                    Warning: This action cannot be undone. All your data, orders, and account
                    information will be permanently deleted.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Enter your password
                  </label>
                  <input
                    type="password"
                    name="password"
                    value={deleteData.password}
                    onChange={handleDeleteChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-background text-foreground ${
                      deleteErrors.password ? 'border-red-500' : 'border-input'
                    }`}
                  />
                  {deleteErrors.password && (
                    <p className="mt-1 text-sm text-red-500">{deleteErrors.password}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Type <span className="font-bold">DELETE</span> to confirm
                  </label>
                  <input
                    type="text"
                    name="confirmText"
                    value={deleteData.confirmText}
                    onChange={handleDeleteChange}
                    className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-background text-foreground ${
                      deleteErrors.confirmText ? 'border-red-500' : 'border-input'
                    }`}
                    placeholder="DELETE"
                  />
                  {deleteErrors.confirmText && (
                    <p className="mt-1 text-sm text-red-500">{deleteErrors.confirmText}</p>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? 'Deleting...' : 'Delete My Account'}
                  </button>
                  <button
                    onClick={() => {
                      setIsDeletingAccount(false);
                      setDeleteData({ password: '', confirmText: '' });
                      setDeleteErrors({});
                    }}
                    className="px-6 py-2.5 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground mb-4">
                  Once you delete your account, there is no going back. Please be certain.
                </p>
                <button
                  onClick={() => setIsDeletingAccount(true)}
                  className="px-6 py-2.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors font-medium cursor-pointer"
                >
                  Delete Account
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
