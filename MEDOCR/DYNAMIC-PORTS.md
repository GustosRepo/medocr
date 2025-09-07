# 🚀 Dynamic Port Configuration

The MEDOCR system now supports dynamic port assignment to avoid conflicts and make development easier.

## 🔧 Backend Port Management

### **Automatic Port Discovery**
The backend automatically finds available ports:
- **Default**: Starts at port 5001
- **Auto-discovery**: If 5001 is busy, tries 5002, 5003, etc.
- **Range**: Searches ports 5001-5010
- **Fallback**: Uses environment variable if specified

### **Manual Port Configuration**
```bash
# Method 1: Environment variable
export PORT=5001
npm run dev

# Method 2: Inline command
PORT=5001 npm run dev

# Method 3: .env file
echo "PORT=5001" > backend/.env
npm run dev

# Method 4: Use predefined scripts
npm run dev:5001    # Force port 5001
npm run dev:5000    # Force port 5000  
npm run dev:auto    # Auto-discover port
```

## 🌐 Frontend Port Discovery

### **Automatic Backend Discovery**
The frontend automatically discovers the backend:
- **Smart Discovery**: Tries ports 5001, 5000, 3001, 8000, 8080
- **Health Checks**: Uses `/health` endpoint to verify backend
- **Caching**: Caches discovered URL for performance
- **Fallback**: Uses environment variable if discovery fails

### **Manual Backend Configuration**
```bash
# Method 1: Environment variable
export REACT_APP_BACKEND_URL=http://localhost:5001
npm start

# Method 2: .env file
echo "REACT_APP_BACKEND_URL=http://localhost:5001" > .env
npm start
```

## 📡 Port Information

### **Backend Writes Port Info**
The backend creates `backend/port-info.json`:
```json
{
  "port": 5001,
  "timestamp": "2025-09-06T...",
  "endpoints": {
    "ocr": "http://localhost:5001/ocr",
    "progress": "http://localhost:5001/progress", 
    "feedback": "http://localhost:5001/feedback",
    "export": "http://localhost:5001/export-combined-pdf"
  }
}
```

### **Frontend Reads Port Info**
The frontend can read this file for guaranteed accuracy.

## 🔄 Development Workflow

### **Easy Startup**
```bash
# Terminal 1: Backend (auto-discovers port)
cd backend
npm run dev

# Terminal 2: Frontend (auto-discovers backend)  
cd ../
npm start
```

### **Port Conflict Resolution**
If ports are busy:
1. **Backend**: Automatically finds next available port
2. **Frontend**: Automatically discovers new backend port
3. **No manual intervention needed!**

## 🎯 Benefits

- **✅ No More Port Conflicts**: Automatic conflict resolution
- **✅ Zero Configuration**: Works out of the box
- **✅ Flexible Deployment**: Easy port changes for different environments
- **✅ Developer Friendly**: No need to remember or manage ports
- **✅ Production Ready**: Environment variable support

## 🚨 Troubleshooting

### **Backend Won't Start**
```bash
# Check what's using ports
lsof -i :5000-5010

# Kill processes if needed
pkill -f "node.*index.js"

# Start fresh
npm run dev:auto
```

### **Frontend Can't Find Backend**
```bash
# Check backend is running
curl http://localhost:5001/health

# Force specific backend URL
export REACT_APP_BACKEND_URL=http://localhost:5001
npm start
```

### **Clear Cached Discovery**
Refresh the page or restart the frontend to clear cached backend URL.
