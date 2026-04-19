from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from rig_guru.database import Base


class Users(Base):
    __tablename__ = "Users"

    userID = Column(Integer, primary_key=True, autoincrement=True, index=True)
    username = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password = Column(String(255), nullable=False)
    premiumStatus = Column(Boolean, nullable=False, default=False)
    googleSub = Column(String(255), nullable=True, unique=True, index=True)

    user_data = relationship("UserData", back_populates="user", uselist=False, cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="user", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")


class UserData(Base):
    __tablename__ = "UserData"

    userID = Column(Integer, ForeignKey("Users.userID", ondelete="CASCADE"), primary_key=True, index=True)
    technicalLevel = Column(String(50), nullable=True)
    brandPreference = Column(String(100), nullable=True)
    budgetRange = Column(String(100), nullable=True)
    usageIntent = Column(String(255), nullable=True)

    user = relationship("Users", back_populates="user_data")


class Conversation(Base):
    """A chat thread owned by one user (sidebar item)."""

    __tablename__ = "Conversation"

    conversationID = Column(Integer, primary_key=True, autoincrement=True, index=True)
    userID = Column(Integer, ForeignKey("Users.userID", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="New chat")
    pinned = Column(Boolean, nullable=False, default=False)
    titleIsCustom = Column(Boolean, nullable=False, default=False)
    createdAt = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updatedAt = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("Users", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "Message"

    messageID = Column(Integer, primary_key=True, autoincrement=True, index=True)
    userID = Column(Integer, ForeignKey("Users.userID", ondelete="CASCADE"), nullable=False, index=True)
    conversationID = Column(
        Integer,
        ForeignKey("Conversation.conversationID", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    senderRole = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)

    user = relationship("Users", back_populates="messages")
    conversation = relationship("Conversation", back_populates="messages")
