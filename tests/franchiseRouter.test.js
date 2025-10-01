const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../src/database/database', () => ({
  DB: {
    getFranchises: jest.fn(),
    getUserFranchises: jest.fn(),
    createFranchise: jest.fn(),
    deleteFranchise: jest.fn(),
    getFranchise: jest.fn(),
    createStore: jest.fn(),
    deleteStore: jest.fn(),
    isLoggedIn: jest.fn(),
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
const { setAuthUser } = require('../src/routes/authRouter');
const franchiseRouter = require('../src/routes/franchiseRouter');

const app = express();
app.use(express.json());
app.use(setAuthUser);
app.use('/api/franchise', franchiseRouter);

describe('franchiseRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/franchise', () => {
    test('returns all franchises with pagination', async () => {
      const mockFranchises = [
        {
          id: 1,
          name: 'pizzaPocket',
          admins: [{ id: 4, name: 'pizza franchisee', email: 'f@jwt.com' }],
          stores: [{ id: 1, name: 'SLC', totalRevenue: 0 }],
        },
      ];
      const mockMore = true;

      DB.getFranchises.mockResolvedValue([mockFranchises, mockMore]);

      const response = await request(app)
        .get('/api/franchise')
        .query({ page: 0, limit: 10, name: 'pizzaPocket' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        franchises: mockFranchises,
        more: mockMore,
      });
      expect(DB.getFranchises).toHaveBeenCalledWith(undefined, '0', '10', 'pizzaPocket');
    });

    test('returns franchises without query parameters', async () => {
      const mockFranchises = [];
      const mockMore = false;

      DB.getFranchises.mockResolvedValue([mockFranchises, mockMore]);

      const response = await request(app).get('/api/franchise');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        franchises: mockFranchises,
        more: mockMore,
      });
      expect(DB.getFranchises).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    });
  });

  describe('GET /api/franchise/:userId', () => {
    test('returns user franchises when user requests their own', async () => {
      const mockUser = {
        id: 1,
        name: 'Test User',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
      };
      const mockFranchises = [
        {
          id: 2,
          name: 'pizzaPocket',
          admins: [{ id: 1, name: 'Test User', email: 'test@jwt.com' }],
          stores: [{ id: 4, name: 'SLC', totalRevenue: 0 }],
        },
      ];
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.getUserFranchises.mockResolvedValue(mockFranchises);

      const response = await request(app)
        .get('/api/franchise/1')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockFranchises);
      expect(DB.getUserFranchises).toHaveBeenCalledWith(1);
    });

    test('returns user franchises when admin requests any user', async () => {
      const mockUser = {
        id: 1,
        name: 'Admin User',
        email: 'admin@jwt.com',
        roles: [{ role: 'admin' }],
      };
      const mockFranchises = [
        {
          id: 2,
          name: 'pizzaPocket',
          admins: [{ id: 5, name: 'Other User', email: 'other@jwt.com' }],
          stores: [{ id: 4, name: 'SLC', totalRevenue: 0 }],
        },
      ];
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.getUserFranchises.mockResolvedValue(mockFranchises);

      const response = await request(app)
        .get('/api/franchise/5')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockFranchises);
      expect(DB.getUserFranchises).toHaveBeenCalledWith(5);
    });

    test('returns empty array when user requests another user franchises', async () => {
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
        .get('/api/franchise/5')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(DB.getUserFranchises).not.toHaveBeenCalled();
    });

    test('fails without authentication', async () => {
      const response = await request(app).get('/api/franchise/1');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
    });
  });

  describe('POST /api/franchise', () => {
    test('allows admin to create franchise', async () => {
      const mockUser = {
        id: 1,
        name: 'Admin User',
        email: 'admin@jwt.com',
        roles: [{ role: 'admin' }],
      };
      const franchiseData = {
        name: 'pizzaPocket',
        admins: [{ email: 'f@jwt.com' }],
      };
      const createdFranchise = {
        id: 1,
        name: 'pizzaPocket',
        admins: [{ email: 'f@jwt.com', id: 4, name: 'pizza franchisee' }],
      };
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.createFranchise.mockResolvedValue(createdFranchise);

      const response = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(franchiseData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(createdFranchise);
      expect(DB.createFranchise).toHaveBeenCalledWith(franchiseData);
    });

    test('fails without authentication', async () => {
      const franchiseData = {
        name: 'pizzaPocket',
        admins: [{ email: 'f@jwt.com' }],
      };

      const response = await request(app)
        .post('/api/franchise')
        .send(franchiseData);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
    });
  });

  describe('DELETE /api/franchise/:franchiseId', () => {
    test('deletes franchise', async () => {
      DB.deleteFranchise.mockResolvedValue();

      const response = await request(app).delete('/api/franchise/1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'franchise deleted' });
      expect(DB.deleteFranchise).toHaveBeenCalledWith(1);
    });
  });

});
