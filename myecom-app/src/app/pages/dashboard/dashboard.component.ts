import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <div class="page">
      <h1>Dashboard</h1>
      <p>Welcome to your dashboard.</p>
      @if (userData$ | async; as user) {
        <div class="card">
          <h3>User Info</h3>
          <p><strong>Name:</strong> {{ user.preferred_username }}</p>
          <p><strong>Email:</strong> {{ user.email }}</p>
        </div>
      }
      @if (orders.length) {
        <h2>Recent Orders</h2>
        <div class="grid">
          @for (order of orders; track order.id) {
            <div class="card">
              <h3>Order #{{ order.id }}</h3>
              <p>{{ order.product }} - {{ order.status }}</p>
              <p class="price">\${{ order.total }}</p>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private authService = inject(AuthService);
  private apiService = inject(ApiService);
  userData$ = this.authService.userData$;
  orders: any[] = [];

  ngOnInit() {
    this.apiService.getOrders().subscribe({
      next: (data) => this.orders = data,
      error: () => {},
    });
  }
}
