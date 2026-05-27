export interface User {
  id: number;
  username: string;
  email: string;
  password: string;
  roles: string[];
  permissions: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
