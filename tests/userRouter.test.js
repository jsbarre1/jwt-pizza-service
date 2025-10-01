const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../src/database/database', () => ({
  DB: {
    updateUser: jest.fn(),
    isLoggedIn: jest.fn(),
    loginUser: jest.fn(),
  },
  Role: {
    Admin: 'admin',
    Diner: 'diner',
    Franchisee: 'franchisee',
  },
}));

jest.mock('jsonwebtoken');
jest.mock('../src/config', () => ({ jwtSecret: 'test-secret' }));

const { DB, Role } = require('../src/database/database');
const { authRouter, setAuthUser } = require('../src/routes/authRouter');
const userRouter = require('../src/routes/userRouter');

const app = express();
app.use(express.json());
app.use(setAuthUser);
app.use('/api/user', userRouter);

describe('userRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/user/me', () => {
    test('returns authenticated user', async () => {
      const mockUser = {
        id: 1,
        name: 'Test User',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);

      const response = await request(app)
        .get('/api/user/me')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mockUser.id,
        name: mockUser.name,
        email: mockUser.email,
        roles: mockUser.roles,
      });
      expect(DB.isLoggedIn).toHaveBeenCalledWith(mockToken);
      expect(jwt.verify).toHaveBeenCalledWith(mockToken, 'test-secret');
    });

    test('fails without authentication', async () => {
      const response = await request(app).get('/api/user/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
    });

    test('fails with invalid token', async () => {
      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .get('/api/user/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
    });
  });

  describe('PUT /api/user/:userId', () => {
    test('allows user to update their own information', async () => {
      const mockUser = {
        id: 1,
        name: 'Test User',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const updatedUser = {
        id: 1,
        name: 'Updated User',
        email: 'updated@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const mockToken = 'mock-jwt-token';
      const newToken = 'new-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.updateUser.mockResolvedValue(updatedUser);
      jwt.sign.mockReturnValue(newToken);
      DB.loginUser.mockResolvedValue();

      const response = await request(app)
        .put('/api/user/1')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          name: 'Updated User',
          email: 'updated@jwt.com',
          password: 'newpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: updatedUser,
        token: newToken,
      });
      expect(DB.updateUser).toHaveBeenCalledWith(1, 'Updated User', 'updated@jwt.com', 'newpassword123');
      expect(jwt.sign).toHaveBeenCalledWith(updatedUser, 'test-secret');
      expect(DB.loginUser).toHaveBeenCalledWith(updatedUser.id, newToken);
    });

    test('allows admin to update another user', async () => {
      const mockUser = {
        id: 1,
        name: 'Admin User',
        email: 'admin@jwt.com',
        roles: [{ role: 'admin' }],
      };
      const updatedUser = {
        id: 2,
        name: 'Updated User',
        email: 'updated@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const mockToken = 'mock-jwt-token';
      const newToken = 'new-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.updateUser.mockResolvedValue(updatedUser);
      jwt.sign.mockReturnValue(newToken);
      DB.loginUser.mockResolvedValue();

      const response = await request(app)
        .put('/api/user/2')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          name: 'Updated User',
          email: 'updated@jwt.com',
          password: 'newpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: updatedUser,
        token: newToken,
      });
      expect(DB.updateUser).toHaveBeenCalledWith(2, 'Updated User', 'updated@jwt.com', 'newpassword123');
    });

    test('prevents non-admin from updating another user', async () => {
      const mockUser = {
        id: 1,
        name: 'Regular User',
        email: 'user@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);

      const response = await request(app)
        .put('/api/user/2')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          name: 'Updated User',
          email: 'updated@jwt.com',
          password: 'newpassword123',
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: 'unauthorized' });
      expect(DB.updateUser).not.toHaveBeenCalled();
    });

    test('fails without authentication', async () => {
      const response = await request(app)
        .put('/api/user/1')
        .send({
          name: 'Updated User',
          email: 'updated@jwt.com',
          password: 'newpassword123',
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
      expect(DB.updateUser).not.toHaveBeenCalled();
    });

    test('fails with invalid token', async () => {
      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .put('/api/user/1')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          name: 'Updated User',
          email: 'updated@jwt.com',
          password: 'newpassword123',
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
      expect(DB.updateUser).not.toHaveBeenCalled();
    });

    test('updates user with partial information', async () => {
      const mockUser = {
        id: 1,
        name: 'Test User',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const updatedUser = {
        id: 1,
        name: 'New Name',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const mockToken = 'mock-jwt-token';
      const newToken = 'new-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.updateUser.mockResolvedValue(updatedUser);
      jwt.sign.mockReturnValue(newToken);
      DB.loginUser.mockResolvedValue();

      const response = await request(app)
        .put('/api/user/1')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          name: 'New Name',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: updatedUser,
        token: newToken,
      });
      expect(DB.updateUser).toHaveBeenCalledWith(1, 'New Name', undefined, undefined);
    });
  });
});
