import { Component, OnInit, inject } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  template: `
    <div class="page">
      <h1>User Management</h1>
      <table class="data-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          @for (u of users; track u.username) {
            <tr>
              <td>{{ u.username }}</td>
              <td>{{ u.email }}</td>
              <td>{{ u.role }}</td>
              <td>{{ u.active ? 'Active' : 'Inactive' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class UserManagementComponent implements OnInit {
  private apiService = inject(ApiService);
  users: any[] = [];

  ngOnInit() {
    this.apiService.getAllUsers().subscribe({
      next: (data) => this.users = data,
      error: () => {},
    });
  }
}
