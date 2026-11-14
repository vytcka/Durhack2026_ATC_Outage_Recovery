import sys
import os


class DataStream:
    def __init__(self, file_path):
        self.file_path = file_path
        self.file = None

    def open(self):
        try:
            self.file = open(self.file_path, 'r')
        except FileNotFoundError:
            print(f"Error: The file '{self.file_path}' was not found.")
            sys.exit(1)
        except IOError:
            print(f"Error: Could not read the file '{self.file_path}'.")
            sys.exit(1)

    def read_line(self):
        if self.file is None:
            print("Error: File is not open. Call the 'open' method first.")
            return None
        return self.file.readline()

    def close(self):
        if self.file is not None:
            self.file.close()