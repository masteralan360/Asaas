# Members System Documentation

## Overview
The Members System allows workspace administrators to manage their team members effectively. It provides functionality to view all members, their roles, and join dates, as well as the ability to "kick" (remove) members from the workspace.

## Features

### 1. Members List
- **Route**: `/members`
- **Access**: Admin only
- **Description**: Displays a table of all users currently associated with the workspace.
- **Columns**:
  - Name
  - Role (Admin, Staff, Viewer)
  - Joined Date
  - Actions (Kick button for admins)

### 2. Kicking Members
- **Functionality**: Allows admins to remove users from the workspace.
- **Restrictions**:
  - Admins cannot kick other admins.
  - Admins cannot kick themselves.
- **Outcome**: 
  - The kicked user has their `workspace_id` set to `NULL`.
  - Their role is preserved.
  - They lose access to all workspace data immediately.
  - Upon next interaction/refresh, they are redirected to the workspace registration page.

### 3. Workspace Registration (Re-joining)
- **Route**: `/workspace-registration`
- **Access**: Authenticated users without a workspace (including kicked users).
- **Description**: A landing page for users who are authenticated but not part of any workspace.
- **Action**: Users must enter a valid Workspace Code to join a new workspace (or rejoin the old one).
- **Process**:
  1. User enters code.
  2. System validates code and updates user's `workspace_id`.
  3. User is redirected to Dashboard upon success.

## Technical Implementation

### Database Changes
- **Table**: `public.profile`
  - `workspace_id` column is nullable.
- **RPC Functions**:
  - `kick_member(target_user_id UUID)`: Removes `workspace_id` from the target user. Check for admin privileges and valid target.
  - `join_workspace(workspace_code_input TEXT)`: Updates `workspace_id` based on the provided code.

### Frontend Components
- **`Members.tsx`**: Main page component for the members list and kick actions.
- **`WorkspaceRegistration.tsx`**: Page for joining a workspace.
- **`AuthContext.tsx`**: Added `isKicked` state and `refreshUser` function to handle session updates.
- **`ProtectedRoute.tsx`**: Modified to redirect `isKicked` users to `/workspace-registration`.

### Security
- **Role-Based Access Control (RBAC)**: Only admins can access the Members page and execute the `kick_member` function.
- **Row Level Security (RLS)**: Users can only view profiles within their workspace. The `kick_member` function uses `SECURITY DEFINER` to bypass RLS for the update operation but strictly checks permissions.

## Usage Guide

### For Admins
1. Navigate to the **Members** tab in the sidebar (between Invoices and Settings).
2. View the list of members.
3. Click the **Kick** button next to a member to remove them.
4. Confirm the action in the dialog.

### For Kicked Users
1. You will be automatically redirected to the **Join Workspace** page.
2. Obtain a valid Workspace Code from your administrator.
3. Enter the code and click **Join Workspace**.
4. You will be returned to the Dashboard with your role intact.
