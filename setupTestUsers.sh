#!/bin/bash

# Check if host is provided as a command line argument
if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 https://pizza.yourdomain.com"
  exit 1
fi

host=$1

echo "Setting up test users on $host..."
echo ""

# Register the diner user
echo "Creating diner user (d@jwt.com)..."
response=$(curl -s -X POST "$host/api/auth" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Diner", "email":"d@jwt.com", "password":"diner"}')
echo "Diner response: $response"
echo ""

# Register the franchisee user (note: this will create as diner, you may need admin to upgrade)
echo "Creating franchisee user (f@jwt.com)..."
response=$(curl -s -X POST "$host/api/auth" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Franchisee", "email":"f@jwt.com", "password":"franchisee"}')
echo "Franchisee response: $response"
echo ""

echo "Test users created!"
echo "Note: The franchisee user may need to be upgraded to franchisee role in the database."
echo "If the traffic script has login failures, check that these users exist and have correct roles."