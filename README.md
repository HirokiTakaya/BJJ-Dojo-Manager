# BJJ Dojo Manager

A full-stack web application built to help Brazilian Jiu-Jitsu academies manage their operations more efficiently.

🎥 **5-Minute Project Walkthrough**
https://drive.google.com/file/d/1x8XTCB_DLLVl82zDQRwJX4Cj-_igyJPR/view?usp=sharing

🌐 **Live Demo**
https://dojo-manager-94b96.web.app/

💻 **GitHub Repository**
https://github.com/HirokiTakaya/BJJ-Dojo-Manager

---

# Project Overview

BJJ Dojo Manager is a full-stack web application designed specifically for Brazilian Jiu-Jitsu academies.

As a Brazilian Jiu-Jitsu instructor, I experienced firsthand how much time coaches spend on repetitive administrative work such as member management, scheduling, attendance tracking, and communication.

I built this application to centralize those workflows into a single platform so instructors can spend more time teaching and less time on administration.

This project represents both my passion for Brazilian Jiu-Jitsu and my interest in building practical software that solves real-world problems.

---

# Why I Built This

Many martial arts academies rely on spreadsheets, messaging apps, and multiple disconnected services.

I wanted to create a platform that combines those workflows into a single system designed specifically for dojo operations.

The project was also an opportunity to strengthen my experience in full-stack development by building an application from the ground up.

---

# Key Features

- Secure authentication
- Email verification
- Role-based access control
- Dojo creation & join flow
- Member management
- Class scheduling
- Attendance management
- Announcements
- Firebase Authentication
- Firestore integration
- Go REST API
- Responsive UI built with Next.js

---

# Tech Stack

## Frontend

- Next.js
- React
- TypeScript

## Backend

- Go
- REST API

## Database

- Firestore

## Authentication

- Firebase Authentication

## Infrastructure

- Firebase Hosting
- Firebase Cloud Services

---

# Architecture

```
Browser
      │
      ▼
Next.js Frontend
      │
      ▼
Go REST API
      │
      ├──────── Firebase Authentication
      │
      └──────── Firestore Database
```

---

# Technical Highlights

This project focuses on building production-oriented software.

Some of the technical challenges included:

- Authentication flow
- Authorization
- Role-based permissions
- Firestore Security Rules
- Backend/frontend communication
- Scalable data structure
- Clean user experience

---

# What I Learned

Building this project improved my experience with:

- Full-stack application architecture
- React / Next.js
- Go backend development
- REST API design
- Authentication & Authorization
- Firestore Security Rules
- Product thinking
- User experience design

Perhaps the biggest lesson was learning how software architecture evolves over time.

Rather than trying to design everything perfectly from the beginning, I learned to build incrementally, refactor continuously, and improve the architecture as requirements became clearer.

---

# Future Improvements

- Stripe subscription system
- Payment management
- Calendar synchronization
- Push notifications
- Mobile application
- Instructor analytics
- AI assistant for dojo management

---

# Local Development

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Backend

```bash
cd backend
go mod tidy
go run .
```

---

# Project Structure

```
BJJ-Dojo-Manager
│
├── backend
├── frontend
├── firestore.rules
├── firebase.json
└── README.md
```

---

# About Me

I'm a Full-Stack Software Engineer and Brazilian Jiu-Jitsu Black Belt based in Vancouver, Canada.

I enjoy building software that solves real problems by combining technical skills with practical experience.

---

# Contact

**Hiroki Takaya**

GitHub:
https://github.com/HirokiTakaya

LinkedIn:
https://www.linkedin.com/in/hiroki-takaya-85b757267/


