#define _POSIX_C_SOURCE 200809L
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <stdio.h>
#include <errno.h>
#include <sys/stat.h>
#define LIMIT (4*1024*1024)
static int write_all(int fd,const unsigned char *buf,size_t size){
 while(size){ssize_t n=write(fd,buf,size);if(n<0&&errno==EINTR)continue;if(n<=0)return -1;buf+=n;size-=(size_t)n;}return 0;
}
int main(int argc,char **argv){
 if(argc!=3)return 2;
 int in=open(argv[1],O_RDONLY);if(in<0){perror("PCM FIFO");return 1;}
 int out=open(argv[2],O_WRONLY|O_CREAT|O_TRUNC,0644);if(out<0){perror("PCM output");return 1;}
 unsigned char buffer[4096];size_t total=0,pending=0;
 for(;;){
  ssize_t n=read(in,buffer+pending,sizeof(buffer)-pending);
  if(n<0&&errno==EINTR)continue;
  if(n<=0)break;
  size_t count=pending+(size_t)n, aligned=count&~(size_t)3;
  if(total+aligned>LIMIT){close(out);unlink(argv[2]);out=open(argv[2],O_WRONLY|O_CREAT|O_TRUNC,0644);if(out<0)return 1;total=0;}
  if(aligned&&write_all(out,buffer,aligned)){perror("PCM write");return 1;}
  total+=aligned;pending=count-aligned;
  for(size_t i=0;i<pending;i++)buffer[i]=buffer[aligned+i];
  struct timespec delay={0,(long)(aligned*1000000000ULL/176400)};
  while(nanosleep(&delay,&delay)&&errno==EINTR){}
 }
 close(out);close(in);return 0;
}
