import { Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="page">
      <h1>Products</h1>
      <div class="grid">
        @for (product of products; track product.id) {
          <div class="card">
            <h3>{{ product.name }}</h3>
            <p>{{ product.description }}</p>
            <p class="price">{{ product.price | number:'1.2-2' }}</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class ProductsComponent {
  products = [
    { id: 1, name: 'Laptop Pro', description: 'High-performance laptop', price: 1299.99 },
    { id: 2, name: 'Wireless Mouse', description: 'Ergonomic wireless mouse', price: 49.99 },
    { id: 3, name: 'Mechanical Keyboard', description: 'RGB mechanical keyboard', price: 129.99 },
    { id: 4, name: 'Monitor 4K', description: '32-inch 4K display', price: 599.99 },
  ];
}
