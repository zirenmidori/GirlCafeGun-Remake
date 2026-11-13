package android.system;
import java.io.*;
import java.nio.file.*;
/** Real host atomic replace; directory sync has no portable JVM equivalent. */
public final class Os {
    public static int journalWrites;
    public static void rename(String from,String to)throws ErrnoException{try{Files.move(Paths.get(from),Paths.get(to),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);if(new File(to).getName().equals("journal.json"))journalWrites++;}catch(IOException e){throw new ErrnoException(e.toString(),5);}}
    public static FileDescriptor open(String name,int flags,int mode)throws ErrnoException{return new FileDescriptor();}
    public static void fsync(FileDescriptor fd)throws ErrnoException{}
    public static void close(FileDescriptor fd)throws ErrnoException{}
}
