# BJJ Dojo Manager

BJJ Dojo Manager is a full-stack web application built to help Brazilian Jiu-Jitsu academies manage their operations more efficiently.

The platform is designed for dojo staff and members, with features for authentication, dojo management, announcements, scheduling, and role-based access control. It was built with a strong focus on practical product development, clean user flows, and real-world usability.

## Features

- Secure user authentication
- Email verification flow
- Dojo creation and join flow
- Role-based access control for staff and members
- Member management
- Announcements and internal communication
- Class and timetable management
- Firebase and Firestore integration
- Backend API built with Go
- Frontend built with Next.js and TypeScript

## Tech Stack

### Frontend
- Next.js
- React
- TypeScript

### Backend
- Go

### Backend / Database / Infrastructure
- Firebase Authentication
- Firestore
- Firebase Hosting
- Cloud-based backend deployment

## Project Structure

```bash
BJJ-Dojo-Manager/
├── backend/        # Go backend API
├── frontend/       # Next.js frontend
├── firestore.rules # Firestore security rules
├── firebase.json   # Firebase configuration
Why I Built This

I built this project to solve real operational problems for martial arts academies.

As someone deeply involved in Brazilian Jiu-Jitsu, I saw opportunities to improve how dojos manage members, communication, and daily workflows. Instead of relying on fragmented tools, I wanted to create a centralized platform tailored to the needs of a dojo environment.

This project also allowed me to strengthen my full-stack development skills by working across frontend, backend, authentication, database design, and security rules.

Technical Focus

One of the key focuses of this project was designing a reliable authentication and access flow.

I worked on:

verified user flows
permission-based access
Firestore security rules
backend and frontend coordination
scalable structure for dojo-related actions

This project reflects how I approach development:

break down complex problems into smaller parts
build working solutions incrementally
improve architecture as requirements become clearer
focus on both usability and maintainability
What I Learned

Through this project, I gained hands-on experience in:

building a full-stack application from scratch
connecting a React/Next.js frontend with a Go backend
implementing authentication and authorization flows
structuring Firestore data and security rules
improving user flows based on real product needs
Future Improvements
Billing and subscription management
More advanced scheduling tools
Notifications and reminders
Improved analytics for dojo staff
Mobile-friendly feature expansion
Run Locally
Prerequisites
Node.js
Go
Firebase project setup
Frontend
cd frontend
npm install
npm run dev
Backend
cd backend
go mod tidy
go run .
Notes

This project is part of my portfolio and represents my interest in building practical, production-oriented software that solves real problems.

Author

Hiroki Takaya
GitHub: https://github.com/HirokiTakaya


---

BJJ Dojo Manager is a full-stack SaaS-style web application for managing dojo operations, built with Next.js, TypeScript, Go, and Firebase.

It includes authentication, role-based access control, member management, scheduling, and communication features. The goal of the project was to build a practical, production-oriented tool that solves real workflow problems for martial arts academies.
