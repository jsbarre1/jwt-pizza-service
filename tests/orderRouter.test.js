const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../src/database/database', () => ({
  DB: {
    getMenu: jest.fn(),
    addMenuItem: jest.fn(),
    getOrders: jest.fn(),
    addDinerOrder: jest.fn(),
    isLoggedIn: jest.fn(),
  },
  Role: {
    Admin: 'admin',
    Diner: 'diner',
    Franchisee: 'franchisee',
  },
}));

jest.mock('jsonwebtoken');
jest.mock('../src/config', () => ({
  jwtSecret: 'test-secret',
  factory: {
    url: 'http://test-factory.com',
    apiKey: 'test-api-key'
  }
}));

const { DB, Role } = require('../src/database/database');
const { setAuthUser } = require('../src/routes/authRouter');
const orderRouter = require('../src/routes/orderRouter');

const app = express();
app.use(express.json());
app.use(setAuthUser);
app.use('/api/order', orderRouter);

// Mock fetch globally
global.fetch = jest.fn();

describe('orderRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/order/menu', () => {
    test('returns the pizza menu', async () => {
      const mockMenu = [
        { id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' },
        { id: 2, title: 'Pepperoni', image: 'pizza2.png', price: 0.0042, description: 'Spicy treat' }
      ];

      DB.getMenu.mockResolvedValue(mockMenu);

      const response = await request(app).get('/api/order/menu');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockMenu);
      expect(DB.getMenu).toHaveBeenCalledTimes(1);
    });

    test('returns empty array when menu is empty', async () => {
      DB.getMenu.mockResolvedValue([]);

      const response = await request(app).get('/api/order/menu');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('PUT /api/order/menu', () => {
    test('allows admin to add menu item', async () => {
      const mockUser = {
        id: 1,
        name: 'Admin User',
        email: 'admin@jwt.com',
        roles: [{ role: 'admin' }],
        isRole: jest.fn((role) => role === Role.Admin)
      };
      const menuItem = {
        title: 'Student',
        description: 'No topping, no sauce, just carbs',
        image: 'pizza9.png',
        price: 0.0001
      };
      const updatedMenu = [
        { id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' },
        { id: 2, title: 'Student', image: 'pizza9.png', price: 0.0001, description: 'No topping, no sauce, just carbs' }
      ];
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.addMenuItem.mockResolvedValue();
      DB.getMenu.mockResolvedValue(updatedMenu);

      const response = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(menuItem);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedMenu);
      expect(DB.addMenuItem).toHaveBeenCalledWith(menuItem);
      expect(DB.getMenu).toHaveBeenCalledTimes(1);
    });

    test('fails without authentication', async () => {
      const menuItem = {
        title: 'Student',
        description: 'No topping, no sauce, just carbs',
        image: 'pizza9.png',
        price: 0.0001
      };

      const response = await request(app)
        .put('/api/order/menu')
        .send(menuItem);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
    });
  });

  describe('GET /api/order', () => {
    test('returns orders for authenticated user', async () => {
      const mockUser = {
        id: 4,
        name: 'Test User',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
        isRole: jest.fn()
      };
      const mockOrders = {
        dinerId: 4,
        orders: [
          {
            id: 1,
            franchiseId: 1,
            storeId: 1,
            date: '2024-06-05T05:14:40.000Z',
            items: [{ id: 1, menuId: 1, description: 'Veggie', price: 0.05 }]
          }
        ],
        page: 1
      };
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.getOrders.mockResolvedValue(mockOrders);

      const response = await request(app)
        .get('/api/order')
        .set('Authorization', `Bearer ${mockToken}`)
        .query({ page: 1 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOrders);
      expect(DB.getOrders).toHaveBeenCalledWith(mockUser, '1');
    });

    test('returns orders without page parameter', async () => {
      const mockUser = {
        id: 4,
        name: 'Test User',
        email: 'test@jwt.com',
        roles: [{ role: 'diner' }],
        isRole: jest.fn()
      };
      const mockOrders = {
        dinerId: 4,
        orders: [],
        page: 1
      };
      const mockToken = 'mock-jwt-token';

      DB.isLoggedIn.mockResolvedValue(true);
      jwt.verify.mockReturnValue(mockUser);
      DB.getOrders.mockResolvedValue(mockOrders);

      const response = await request(app)
        .get('/api/order')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOrders);
      expect(DB.getOrders).toHaveBeenCalledWith(mockUser, undefined);
    });

    test('fails without authentication', async () => {
      const response = await request(app).get('/api/order');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'unauthorized' });
    });
  });

});
