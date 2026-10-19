{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "test-results", "playwright-report", ".auth"]
}
