import { Component, OnInit, inject } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  template: `
    <div class="page">
      <h1>Admin Panel</h1>
      <p>Administrative controls and system overview.</p>
      <div class="grid">
        <div class="card">
          <h3>System Status</h3>
          <p>All systems operational</p>
        </div>
        <div class="card">
          <h3>Total Users</h3>
          <p>{{ stats?.total_users ?? '-' }}</p>
        </div>
        <div class="card">
          <h3>Total Products</h3>
          <p>{{ stats?.total_products ?? '-' }}</p>
        </div>
        <div class="card">
          <h3>Total Orders</h3>
          <p>{{ stats?.total_orders ?? '-' }}</p>
        </div>
        <div class="card">
          <h3>Revenue</h3>
          <p class="price">\${{ stats?.revenue ?? '-' }}</p>
        </div>
      </div>
    </div>
  `,
})
export class AdminPanelComponent implements OnInit {
  private apiService = inject(ApiService);
  stats: any = null;

  ngOnInit() {
    this.apiService.getStats().subscribe({
      next: (data) => this.stats = data,
      error: () => {},
    });
  }
}
