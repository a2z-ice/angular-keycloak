import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = '';

  // User endpoints
  getProfile(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/user/profile`);
  }

  getProducts(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/user/products`);
  }

  getOrders(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/user/orders`);
  }

  // Admin endpoints
  getAllUsers(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/admin/users`);
  }

  getStats(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/admin/stats`);
  }

  getSettings(): Observable<any> {
    return this.http.get(`${this.baseUrl}/api/admin/settings`);
  }
}
