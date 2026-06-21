#!/usr/bin/env python3
"""
B² Transparent AG-UI Dispatcher
Simple transparent routing to tenant-specific AG-UI services (Cloud Run).

Architecture:
Widget (ag-ui) → Dispatcher → Tenant AG-UI Services (Cloud Run)
                              ├─ tenant-abc-123.run.app/agent
                              ├─ tenant-xyz-456.run.app/agent  
                              └─ demo-tenant.run.app/agent
"""

import asyncio
import json
import httpx
from typing import Dict, Any, Optional
from urllib.parse import urljoin

from fastapi import FastAPI, HTTPException, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
import os

class TenantRegistry:
    """Registry for tenant service URLs."""
    
    def __init__(self):
        # In production, this would come from environment variables,
        # service discovery, or Cloud Run service listing
        self.tenant_services = {
            "tenant-a": "http://localhost:8001",
            "tenant-b": "http://localhost:8002",
        }

        # For local development, use localhost ports
        if os.getenv("ENVIRONMENT") == "local":
            self.tenant_services = {
                "tenant-a": "http://localhost:8001",
                "tenant-b": "http://localhost:8002",
            }
    
    def get_tenant_url(self, tenant_id: str) -> Optional[str]:
        """Get the service URL for a tenant."""
        return self.tenant_services.get(tenant_id)
    
    def list_tenants(self) -> Dict[str, str]:
        """List all registered tenants."""
        return self.tenant_services.copy()

class AGUIDispatcher:
    """Transparent dispatcher for AG-UI requests to tenant services."""
    
    def __init__(self):
        self.registry = TenantRegistry()
        self.client = httpx.AsyncClient(timeout=60.0)
    
    def extract_tenant_id(self, request: Request) -> Optional[str]:
        """Extract tenant ID from request headers or token."""
        # Try X-Tenant-ID header first
        tenant_id = request.headers.get("x-tenant-id")
        if tenant_id:
            return tenant_id
        
        # Try Authorization token
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            # Simple token-based tenant extraction for demo
            # In production, decode JWT and extract tenant claim
            for tid in self.registry.list_tenants():
                if tid in token:
                    return tid
        
        # Try query parameter
        tenant_id = request.query_params.get("tenant_id")
        if tenant_id:
            return tenant_id
            
        return None
    
    async def proxy_request(
        self, 
        request: Request, 
        tenant_url: str, 
        path: str = "/agent"
    ) -> Response:
        """Transparently proxy the request to tenant service."""
        target_url = urljoin(tenant_url, path)
        
        # Copy headers (exclude host)
        headers = dict(request.headers)
        headers.pop("host", None)
        
        # Copy query parameters
        query_params = dict(request.query_params)
        
        try:
            # Handle different HTTP methods
            if request.method == "GET":
                response = await self.client.get(
                    target_url,
                    headers=headers,
                    params=query_params
                )
            elif request.method == "POST":
                body = await request.body()
                response = await self.client.post(
                    target_url,
                    headers=headers,
                    params=query_params,
                    content=body
                )
            elif request.method == "PUT":
                body = await request.body()
                response = await self.client.put(
                    target_url,
                    headers=headers,
                    params=query_params,
                    content=body
                )
            elif request.method == "DELETE":
                response = await self.client.delete(
                    target_url,
                    headers=headers,
                    params=query_params
                )
            else:
                raise HTTPException(status_code=405, detail=f"Method {request.method} not allowed")
            
            # Handle streaming responses (important for AG-UI WebSocket/SSE)
            if response.headers.get("content-type", "").startswith("text/event-stream"):
                return StreamingResponse(
                    self.stream_response(response),
                    media_type=response.headers.get("content-type"),
                    headers={k: v for k, v in response.headers.items() if k.lower() not in ["content-length", "transfer-encoding"]}
                )
            
            # Regular response
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers={k: v for k, v in response.headers.items() if k.lower() not in ["content-length", "transfer-encoding"]}
            )
            
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Service unavailable: {str(e)}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))
    
    async def stream_response(self, response):
        """Stream response for AG-UI real-time communication."""
        async for chunk in response.aiter_bytes():
            yield chunk
    
    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

# FastAPI app
app = FastAPI(
    title="B² AG-UI Dispatcher",
    description="Transparent routing to tenant-specific AG-UI services",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global dispatcher instance
dispatcher = AGUIDispatcher()

@app.get("/")
async def root():
    """Root endpoint with dispatcher information."""
    return {
        "service": "B² AG-UI Dispatcher",
        "version": "1.0.0",
        "architecture": "Widget (ag-ui) → Dispatcher → Tenant Services (Cloud Run)",
        "registered_tenants": list(dispatcher.registry.list_tenants().keys()),
        "routing": {
            "header": "X-Tenant-ID",
            "token": "Bearer demo-token-{tenant_id}",
            "query": "?tenant_id={tenant_id}"
        }
    }

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "dispatcher": "running"}

@app.post("/host-action-result")
async def route_host_action_result(request: Request):
    """Route host action results to appropriate tenant service."""
    tenant_id = dispatcher.extract_tenant_id(request)
    
    if not tenant_id:
        raise HTTPException(
            status_code=400, 
            detail="Tenant ID required for host action result."
        )
    
    # Get tenant service URL
    tenant_url = dispatcher.registry.get_tenant_url(tenant_id)
    
    if not tenant_url:
        raise HTTPException(
            status_code=404,
            detail=f"Tenant '{tenant_id}' not found."
        )
    
    # Proxy the host action result to tenant service
    return await dispatcher.proxy_request(request, tenant_url, "/host-action-result")

@app.get("/tenants")
async def list_tenants():
    """List all registered tenant services."""
    return {
        "tenants": [
            {
                "tenant_id": tid,
                "service_url": url,
                "ag_ui_endpoint": f"{url}/agent"
            }
            for tid, url in dispatcher.registry.list_tenants().items()
        ]
    }

@app.api_route("/agent", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
@app.api_route("/agent/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def route_to_tenant(request: Request, path: str = ""):
    """Route AG-UI requests to appropriate tenant service."""
    
    # Extract tenant ID from request
    tenant_id = dispatcher.extract_tenant_id(request)
    
    if not tenant_id:
        raise HTTPException(
            status_code=400, 
            detail="Tenant ID required. Use X-Tenant-ID header, token, or ?tenant_id query parameter."
        )
    
    # Get tenant service URL
    tenant_url = dispatcher.registry.get_tenant_url(tenant_id)
    
    if not tenant_url:
        raise HTTPException(
            status_code=404,
            detail=f"Tenant '{tenant_id}' not found. Available: {list(dispatcher.registry.list_tenants().keys())}"
        )
    
    # Construct target path
    target_path = f"/agent/{path}" if path else "/agent"
    
    # Proxy the request transparently
    return await dispatcher.proxy_request(request, tenant_url, target_path)

@app.on_event("shutdown")
async def cleanup():
    """Cleanup resources on shutdown."""
    await dispatcher.close()

if __name__ == "__main__":
    import uvicorn
    
    print("🌟 Starting B² AG-UI Dispatcher")
    print("🔗 Architecture: Widget → Dispatcher → Tenant Cloud Run Services")
    print("📡 Widget connects to: http://localhost:8000/agent")
    print("🎯 Routes to tenant services:")
    
    registry = TenantRegistry()
    for tenant_id, url in registry.list_tenants().items():
        print(f"   • {tenant_id}: {url}/agent")
    
    print("\n🔧 Tenant ID extraction methods:")
    print("   • Header: X-Tenant-ID")
    print("   • Token: Bearer demo-token-{tenant_id}")
    print("   • Query: ?tenant_id={tenant_id}")
    
    uvicorn.run(
        "main_dispatcher:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
