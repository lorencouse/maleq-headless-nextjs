'use client';

import { useState } from 'react';
import AccountLayout from '@/components/account/AccountLayout';
import { useAuthStore } from '@/lib/store/auth-store';

export default function AccountDetailsPage() {
  const { user, token, setUser } = useAuthStore();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

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
        throw new Error('Failed to update profile');
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
                className="text-sm text-primary hover:text-primary-hover font-medium"
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
                    className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50"
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
                    className="px-6 py-2.5 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    {user?.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.displayName}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-xl font-bold text-primary">
                        {user?.firstName?.charAt(0) || 'U'}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{user?.displayName}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
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
                className="text-sm text-primary hover:text-primary-hover font-medium"
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
                    className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-semibold disabled:opacity-50"
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
                    className="px-6 py-2.5 border border-input rounded-lg hover:bg-muted transition-colors font-medium text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Your password was last changed on a previous date. For security, we recommend
                changing your password regularly.
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
            <p className="text-muted-foreground mb-4">
              Once you delete your account, there is no going back. Please be certain.
            </p>
            <button className="px-6 py-2.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors font-medium">
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
