const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../src/database/database', () => ({
  DB: {
    getUser: jest.fn(),
    loginUser: jest.fn(),
    isLoggedIn: jest.fn(),
    logoutUser: jest.fn(),
  },
  Role: {
    Admin: 'admin',
    Diner: 'diner',
    Franchisee: 'franchisee',
  },
}));

jest.mock('jsonwebtoken');
jest.mock('../src/config', () => ({ jwtSecret: 'test-secret' }));

const { DB } = require('../src/database/database');
const { authRouter, setAuthUser } = require('../src/routes/authRouter');

const app = express();
app.use(express.json());
app.use(setAuthUser);
app.use('/api/auth', authRouter);

describe('authRouter login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successful login returns user and token', async () => {
    const mockUser = {
      id: 1,
      name: 'Test User',
      email: 'test@jwt.com',
      roles: [{ role: 'diner' }],
    };
    const mockToken = 'mock-jwt-token';

    DB.getUser.mockResolvedValue(mockUser);
    DB.loginUser.mockResolvedValue();
    jwt.sign.mockReturnValue(mockToken);

    const response = await request(app)
      .put('/api/auth')
      .send({ email: 'test@jwt.com', password: 'test' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: mockUser,
      token: mockToken,
    });
    expect(DB.getUser).toHaveBeenCalledWith('test@jwt.com', 'test');
    expect(jwt.sign).toHaveBeenCalledWith(mockUser, 'test-secret');
    expect(DB.loginUser).toHaveBeenCalledWith(mockUser.id, mockToken);
  });

  test('successful logout returns message', async () => {
    const mockToken = 'mock-jwt-token';
    const mockUser = {
      id: 1,
      name: 'Test User',
      email: 'test@jwt.com',
      roles: [{ role: 'diner' }],
    };

    DB.isLoggedIn.mockResolvedValue(true);
    DB.logoutUser.mockResolvedValue();
    jwt.verify.mockReturnValue(mockUser);

    const response = await request(app)
      .delete('/api/auth')
      .set('Authorization', `Bearer ${mockToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'logout successful' });
    expect(DB.logoutUser).toHaveBeenCalledWith(mockToken);
  });
});